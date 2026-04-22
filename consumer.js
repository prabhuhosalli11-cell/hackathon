// ============================================================================
//  KAFKA EVENT ENRICHMENT ENGINE — "Midfield Data Control"
//  consumer.js | Production-Grade Stream Processor
// ============================================================================
//  Architecture:
//    1. Consume raw events from `midfield-raw` topic
//    2. Deduplicate via Redis SETNX (atomic idempotency gate)
//    3. Enrich with user profile data (cache-first → API fallback)
//    4. Produce enriched payloads to `midfield-enriched` topic
//    5. Broadcast real-time telemetry over WebSocket (port 8080)
// ============================================================================

// Suppress partitioner warning natively
process.env.KAFKAJS_NO_PARTITIONER_WARNING = '1';

// Suppress TimeoutNegativeWarning caused by KafkaJS internal calculations in 2026
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'TimeoutNegativeWarning') return;
  console.warn(warning.name, warning.message);
});

const { Kafka, logLevel } = require('kafkajs');
const Redis = require('ioredis');
const { WebSocketServer } = require('ws');

// ─── CONFIGURATION ──────────────────────────────────────────────────────────
const CONFIG = {
    kafka: {
        clientId: 'midfield-enrichment-engine',
        brokers: ['localhost:9092'],
        consumerGroup: `midfield-enrichment-group`,
        topicIn: 'midfield-raw',
        topicOut: 'midfield-enriched',
    },
    redis: {
        url: 'redis://localhost:6379',
        idempotencyTTL: 3600,       // 1 hour — block duplicate eventIds
        userCacheTTL: 300,           // 5 minutes — cache user profiles
        keyPrefix: {
            idempotency: 'idem:',     // idem:<eventId>
            userCache: 'user_cache:', // user_cache:<userId>
        },
    },
    api: {
        baseUrl: 'http://localhost:3000/api/users',
        maxRetries: 3,              // Exactly 3 attempts
        baseDelayMs: 1000,          // Exponential backoff: 1s, 2s, 4s...
    },
    ws: {
        port: 8080,                 // WebSocket telemetry port
        broadcastIntervalMs: 1000,  // Push stats every 1 second
    },
};

// ─── TELEMETRY STATE ────────────────────────────────────────────────────────
// Mutable counters that the WebSocket server broadcasts to all dashboard clients.
const telemetry = {
    messagesProcessed: 0,
    messagesDroppedDuplicate: 0,
    cacheHits: 0,
    cacheMisses: 0,
    apiCalls: 0,
    apiRetries: 0,
    apiFails: 0,
    enrichedProduced: 0,
    errorsTotal: 0,
    uptimeSeconds: 0,
    lastEventId: null,
    lastUserId: null,
    lastAction: null,
    // Per-second throughput tracking
    _windowStart: Date.now(),
    _windowCount: 0,
    throughputPerSec: 0,
    // Recent event log for dashboard (ring buffer, last 50)
    recentEvents: [],
};

// ─── KAFKA CLIENTS ──────────────────────────────────────────────────────────
const kafka = new Kafka({
    clientId: CONFIG.kafka.clientId,
    brokers: CONFIG.kafka.brokers,
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 10 },
    connectionTimeout: 10000,   // 10s to connect to broker
});

const consumer = kafka.consumer({ groupId: CONFIG.kafka.consumerGroup });
const producer = kafka.producer({
    allowAutoTopicCreation: true, // Auto-create midfield-enriched if needed
});

// ─── REDIS CLIENT ───────────────────────────────────────────────────────────
const redis = new Redis(CONFIG.redis.url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 2000),
    enableReadyCheck: true,
    lazyConnect: false,
});

redis.on('error', (err) => console.error('[Redis] ❌ Connection error:', err.message));
redis.on('connect', () => console.log('[Redis] ✅ Connected'));

// ============================================================================
//  CORE FUNCTION 1: IDEMPOTENCY GATE (Redis SETNX)
// ============================================================================
//  Uses SET with NX (Set-if-Not-eXists) — an atomic Redis operation.
//  If the key already exists, SETNX returns null → duplicate detected.
//  If the key is new, it's set with a TTL → event is allowed through.
//  This is the ONLY correct way to handle Kafka's at-least-once delivery.
// ============================================================================
async function isEventDuplicate(eventId) {
    const key = `${CONFIG.redis.keyPrefix.idempotency}${eventId}`;

    // SET key "1" NX EX <ttl> — atomic set-if-not-exists with expiry
    // Returns "OK" if the key was SET (new event), null if it already existed (duplicate)
    const result = await redis.set(key, '1', 'EX', CONFIG.redis.idempotencyTTL, 'NX');

    if (result === null) {
        // Key already existed → this event was already processed
        telemetry.messagesDroppedDuplicate++;
        pushRecentEvent('DUPLICATE_BLOCKED', eventId, null, '🟡 Foul / Duplicate Blocked');
        console.log(`[Idempotency] 🟡 FOUL — Duplicate blocked: ${eventId}`);
        return true;
    }

    // Key was freshly set → first time seeing this event
    return false;
}

// ============================================================================
//  CORE FUNCTION 2: CACHE-FIRST USER PROFILE FETCH
// ============================================================================
//  Strategy: Redis Cache → API (with retry) → Cache Write-Through
//  This prevents the API from being hammered by repeated lookups for the
//  same userId across thousands of events in the stream.
// ============================================================================
async function getUserProfile(userId) {
    const cacheKey = `${CONFIG.redis.keyPrefix.userCache}${userId}`;

    // ── STEP 1: Check Redis cache first ──
    const cached = await redis.get(cacheKey);
    if (cached) {
        telemetry.cacheHits++;
        pushRecentEvent('CACHE_HIT', null, userId, '⚡ Cache Hit');
        console.log(`[Cache] ⚡ HIT — User profile served from Redis: ${userId}`);
        return JSON.parse(cached);
    }

    // ── STEP 2: Cache miss — fetch from API with retry ──
    telemetry.cacheMisses++;
    console.log(`[Cache] 🔍 MISS — Fetching ${userId} from User Service API...`);

    const userData = await fetchWithRetry(userId);

    // ── STEP 3: Write-through — populate cache for next 5 minutes ──
    await redis.set(cacheKey, JSON.stringify(userData), 'EX', CONFIG.redis.userCacheTTL);
    console.log(`[Cache] 💾 STORED — ${userId} cached for ${CONFIG.redis.userCacheTTL}s`);

    return userData;
}

// ============================================================================
//  CORE FUNCTION 3: FAULT-TOLERANT API FETCH WITH EXPONENTIAL BACKOFF
// ============================================================================
//  Retry policy: Exactly 3 attempts. Delays: 1s → 2s (exponential).
//  On final failure, throws to the caller so the event can be dead-lettered.
// ============================================================================
async function fetchWithRetry(userId) {
    const url = `${CONFIG.api.baseUrl}/${userId}`;

    for (let attempt = 1; attempt <= CONFIG.api.maxRetries; attempt++) {
        try {
            telemetry.apiCalls++;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log(`[API] ✅ Fetched ${userId} on attempt ${attempt}/${CONFIG.api.maxRetries}`);
            return data;
        } catch (err) {
            // If this is NOT the last attempt, schedule a retry with exponential backoff
            if (attempt < CONFIG.api.maxRetries) {
                // Exponential backoff: 1s * 2^(attempt-1) → 1s, 2s
                const delayMs = CONFIG.api.baseDelayMs * Math.pow(2, attempt - 1);
                telemetry.apiRetries++;
                pushRecentEvent('API_RETRY', null, userId, `⚠️ Retry ${attempt}/${CONFIG.api.maxRetries}`);
                console.warn(
                    `[API] ⚠️ Attempt ${attempt}/${CONFIG.api.maxRetries} failed for ${userId}: ${err.message}. ` +
                    `Retrying in ${delayMs}ms...`
                );
                await sleep(delayMs);
            } else {
                // Final attempt exhausted — propagate the failure
                telemetry.apiFails++;
                pushRecentEvent('API_FAIL', null, userId, `❌ Failed after ${CONFIG.api.maxRetries} attempts`);
                console.error(
                    `[API] ❌ FAILED — All ${CONFIG.api.maxRetries} attempts exhausted for ${userId}: ${err.message}`
                );
                throw new Error(`User Service unreachable for ${userId} after ${CONFIG.api.maxRetries} retries`);
            }
        }
    }
}

// ============================================================================
//  CORE FUNCTION 4: DATA MERGE — Raw Event + User Profile → Enriched JSON
// ============================================================================
function mergeEventWithProfile(rawEvent, userProfile) {
    return {
        // ── Original event fields (pass-through) ──
        eventId: rawEvent.eventId,
        userId: rawEvent.userId,
        action: rawEvent.action,
        timestamp: rawEvent.timestamp,

        // ── Enriched user profile (merged in) ──
        user: {
            name: userProfile.name || null,
            tier: userProfile.tier || null,
            status: userProfile.status || null,
        },

        // ── Pipeline metadata ──
        _enrichment: {
            enrichedAt: new Date().toISOString(),
            engine: CONFIG.kafka.clientId,
            sourcetopic: CONFIG.kafka.topicIn,
            version: '1.0.0',
        },
    };
}

// ============================================================================
//  WEBSOCKET TELEMETRY SERVER
// ============================================================================
//  Broadcasts real-time pipeline metrics to all connected dashboard clients.
//  The frontend connects via `new WebSocket('ws://localhost:8080')` and
//  receives a JSON payload every CONFIG.ws.broadcastIntervalMs (1 second).
// ============================================================================
function startTelemetryServer() {
    const http = require('http');
    const server = http.createServer();

    // Handle port conflict BEFORE creating the WebSocket server
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`[WS] ⚠️ Port ${CONFIG.ws.port} in use — telemetry disabled. Consumer will continue without dashboard.`);
            console.warn(`[WS]    Fix: Run in PowerShell → Get-NetTCPConnection -LocalPort ${CONFIG.ws.port} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
        } else {
            console.error('[WS] ❌ Server error:', err.message);
        }
    });

    // Only create WSS and start broadcasting AFTER the port binds successfully
    server.listen(CONFIG.ws.port, () => {
        console.log(`[WS] 📡 Telemetry server broadcasting on ws://localhost:${CONFIG.ws.port}`);

        const wss = new WebSocketServer({ server });

        wss.on('connection', (socket) => {
            console.log('[WS] 🔌 Dashboard client connected');
            socket.send(JSON.stringify(buildTelemetryPayload()));
            socket.on('close', () => console.log('[WS] 🔌 Dashboard client disconnected'));
            socket.on('error', (err) => console.error('[WS] Client error:', err.message));
        });

        // Broadcast loop — push metrics every second to ALL connected clients
        setInterval(() => {
            telemetry.uptimeSeconds++;
            const now = Date.now();
            const elapsed = (now - telemetry._windowStart) / 1000;
            if (elapsed >= 1) {
                telemetry.throughputPerSec = Math.round(telemetry._windowCount / elapsed);
                telemetry._windowStart = now;
                telemetry._windowCount = 0;
            }

            const payload = JSON.stringify(buildTelemetryPayload());
            wss.clients.forEach((client) => {
                if (client.readyState === 1) client.send(payload);
            });
        }, CONFIG.ws.broadcastIntervalMs);
    });
}

function buildTelemetryPayload() {
    return {
        type: 'telemetry',
        ts: Date.now(),
        metrics: {
            messagesProcessed: telemetry.messagesProcessed,
            duplicatesBlocked: telemetry.messagesDroppedDuplicate,
            cacheHits: telemetry.cacheHits,
            cacheMisses: telemetry.cacheMisses,
            apiCalls: telemetry.apiCalls,
            apiRetries: telemetry.apiRetries,
            apiFails: telemetry.apiFails,
            enrichedProduced: telemetry.enrichedProduced,
            errorsTotal: telemetry.errorsTotal,
            throughputPerSec: telemetry.throughputPerSec,
            uptimeSeconds: telemetry.uptimeSeconds,
            cacheHitRate: telemetry.cacheHits + telemetry.cacheMisses > 0
                ? ((telemetry.cacheHits / (telemetry.cacheHits + telemetry.cacheMisses)) * 100).toFixed(1)
                : '0.0',
        },
        lastEvent: {
            eventId: telemetry.lastEventId,
            userId: telemetry.lastUserId,
            action: telemetry.lastAction,
        },
        recentEvents: telemetry.recentEvents,
    };
}

// ─── Recent events ring buffer (keeps last 50 for dashboard feed) ───────────
function pushRecentEvent(type, eventId, userId, message) {
    telemetry.recentEvents.push({
        type,
        eventId,
        userId,
        message,
        ts: Date.now(),
    });
    // Ring buffer: cap at 50 entries to prevent memory leak
    if (telemetry.recentEvents.length > 50) {
        telemetry.recentEvents.shift();
    }
}

// ─── UTILITY ────────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
//  MAIN PIPELINE — Kafka Consumer Loop
// ============================================================================
async function startPipeline() {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║   MIDFIELD DATA CONTROL — Kafka Event Enrichment Engine    ║');
    console.log('║   Production Mode | Idempotent | Cache-First | Resilient   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    // ── 1. Start WebSocket telemetry FIRST (so dashboards can connect early) ──
    startTelemetryServer();

    // ── 2. Connect Kafka producer (for enriched output) ──
    await producer.connect();
    console.log('[Kafka] ✅ Producer connected → will write to:', CONFIG.kafka.topicOut);

    // ── 3. Connect Kafka consumer ──
    await consumer.connect();
    console.log('[Kafka] ✅ Consumer connected → listening on:', CONFIG.kafka.topicIn);

    // ── 4. Subscribe to the raw events topic ──
    await consumer.subscribe({
        topic: CONFIG.kafka.topicIn,
        fromBeginning: true,
    });

    // ── 5. Main processing loop ──────────────────────────────────────────────
    await consumer.run({
        // Process one message at a time for guaranteed ordering within partition
        eachMessage: async ({ topic, partition, message }) => {
            const startTime = Date.now();

            // ── PARSE ──
            let rawEvent;
            try {
                rawEvent = JSON.parse(message.value.toString());
            } catch (parseErr) {
                telemetry.errorsTotal++;
                console.error('[Pipeline] ❌ Malformed JSON in message, skipping:', parseErr.message);
                return; // Skip unparseable messages — don't crash the consumer
            }

            const { eventId, userId, action } = rawEvent;
            telemetry.lastEventId = eventId;
            telemetry.lastUserId = userId;
            telemetry.lastAction = action;

            console.log(`\n${'─'.repeat(60)}`);
            console.log(`[Pipeline] 📥 RECEIVED | Event: ${eventId} | User: ${userId} | Action: ${action}`);
            console.log(`[Pipeline]    Partition: ${partition} | Offset: ${message.offset}`);

            // ── STEP 1: IDEMPOTENCY GATE ──────────────────────────────────────
            // Uses Redis SETNX — if this eventId was already processed, bail out.
            const isDuplicate = await isEventDuplicate(eventId);
            if (isDuplicate) {
                telemetry.messagesProcessed++;
                telemetry._windowCount++;
                return; // Exit early — do NOT process duplicates
            }

            // ── STEP 2: FETCH USER PROFILE (Cache-First) ─────────────────────
            let userProfile;
            try {
                userProfile = await getUserProfile(userId);
            } catch (fetchErr) {
                // All 3 retries failed — log the error and move on
                // In production, this would go to a Dead Letter Topic (DLT)
                telemetry.errorsTotal++;
                telemetry.messagesProcessed++;
                telemetry._windowCount++;
                pushRecentEvent('ERROR', eventId, userId, `❌ ${fetchErr.message}`);
                console.error(`[Pipeline] ❌ Dropping event ${eventId}: ${fetchErr.message}`);
                return;
            }

            // ── STEP 3: DATA MERGE ───────────────────────────────────────────
            const enrichedEvent = mergeEventWithProfile(rawEvent, userProfile);

            // ── STEP 4: PRODUCE TO ENRICHED TOPIC ────────────────────────────
            await producer.send({
                topic: CONFIG.kafka.topicOut,
                messages: [
                    {
                        key: userId,
                        value: JSON.stringify(enrichedEvent),
                        headers: {
                            'x-source-topic': CONFIG.kafka.topicIn,
                            'x-enriched-at': new Date().toISOString(),
                            'x-engine-version': '1.0.0',
                        },
                    },
                ],
            });

            telemetry.enrichedProduced++;
            telemetry.messagesProcessed++;
            telemetry._windowCount++;

            const latency = Date.now() - startTime;
            pushRecentEvent('ENRICHED', eventId, userId, `✅ Enriched & produced in ${latency}ms`);
            console.log(`[Pipeline] ✅ ENRICHED & PRODUCED | ${eventId} → ${CONFIG.kafka.topicOut} (${latency}ms)`);
        },
    });
}

// ============================================================================
//  GRACEFUL SHUTDOWN — Clean up all connections on SIGINT / SIGTERM
// ============================================================================
const shutdown = async (signal) => {
    console.log(`\n[Shutdown] Received ${signal}. Gracefully shutting down...`);
    try {
        await consumer.disconnect();
        await producer.disconnect();
        await redis.quit();
        console.log('[Shutdown] ✅ All connections closed. Goodbye.');
        process.exit(0);
    } catch (err) {
        console.error('[Shutdown] ❌ Error during shutdown:', err.message);
        process.exit(1);
    }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ─── LAUNCH ─────────────────────────────────────────────────────────────────
startPipeline().catch((err) => {
    console.error('[FATAL] Pipeline failed to start:', err.message);
    process.exit(1);
});