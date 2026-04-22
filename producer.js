// Suppress partitioner warning natively
process.env.KAFKAJS_NO_PARTITIONER_WARNING = '1';

// Suppress TimeoutNegativeWarning caused by KafkaJS internal calculations
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'TimeoutNegativeWarning') return;
  console.warn(warning.name, warning.message);
});

const { Kafka } = require('kafkajs');

const kafka = new Kafka({
    clientId: 'enrichment-producer',
    brokers: ['localhost:9092']
});

const producer = kafka.producer();

const events = [
    { eventId: "evt_001", userId: "user_001", action: "login", timestamp: Date.now() },
    { eventId: "evt_002", userId: "user_002", action: "purchase", amount: 50, timestamp: Date.now() },
    // This user throws a 404 in our API to show retry handling/failure
    { eventId: "evt_003", userId: "user_999", action: "logout", timestamp: Date.now() }, 
    { eventId: "evt_004", userId: "user_004", action: "view_item", itemId: "item_xyz", timestamp: Date.now() },
    // Duplicate of evt_002 to test Redis Idempotency
    { eventId: "evt_002", userId: "user_002", action: "purchase", amount: 50, timestamp: Date.now() },
    // Another valid event
    { eventId: "evt_005", userId: "user_001", action: "purchase", amount: 120, timestamp: Date.now() }
];

async function run() {
    await producer.connect();
    console.log("🚀 [Producer] Connected to Kafka");

    for (const event of events) {
        await producer.send({
            topic: 'midfield-raw',
            messages: [
                { key: event.userId, value: JSON.stringify(event) }
            ],
        });
        console.log(`[Producer] 📨 Sent raw event: ${event.eventId} for ${event.userId}`);
        
        // Wait 2 seconds between sending events to show real-time processing
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    await producer.disconnect();
    console.log("✅ [Producer] All events sent, disconnected.");
}

run().catch(console.error);
