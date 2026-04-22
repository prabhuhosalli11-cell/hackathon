import { useState, useEffect, useRef, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html, Sphere, Cylinder, Box, Line } from "@react-three/drei";
import * as THREE from "three";

// ─── DATA ─────────────────────────────────────────────────────────────────────
const EVENTS = [
  { eventId: "evt_001", userId: "user_001", action: "login" },
  { eventId: "evt_002", userId: "user_002", action: "purchase", amount: 50 },
  { eventId: "evt_003", userId: "user_999", action: "logout" },
  { eventId: "evt_004", userId: "user_004", action: "view_item", itemId: "item_xyz" },
  { eventId: "evt_002", userId: "user_002", action: "purchase", amount: 50 },
  { eventId: "evt_005", userId: "user_001", action: "purchase", amount: 120 },
];

const USERS = {
  user_001: { name: "Alex Striker", tier: "Gold", status: "Active" },
  user_002: { name: "Jordan Defender", tier: "Silver", status: "Active" },
  user_004: { name: "Riley Goalie", tier: "Platinum", status: "Active" },
};

const NODES = [
  { id: "producer", label: "Producer App", position: [-5.5, 0.5, 0], color: "#3b82f6", shape: "box", desc: "Publishes raw events to Kafka topic midfield-raw" },
  { id: "kafka_raw", label: "raw-events", position: [-1.5, 3.2, 0], color: "#f59e0b", shape: "cylinder", desc: "Kafka Topic: Ingests all raw event streams at high throughput" },
  { id: "consumer", label: "Enrichment Consumer", position: [1.5, 0, 0], color: "#8b5cf6", shape: "sphere", desc: "Deduplicates, enriches events, writes to enriched topic" },
  { id: "redis", label: "Redis Cache", position: [4.5, -2.5, 0], color: "#ef4444", shape: "cylinder", desc: "Idempotency gate (SETNX) + user profile cache TTL:5m" },
  { id: "api", label: "User Service API", position: [-2, -2.5, 0], color: "#10b981", shape: "box", desc: "Mock REST API — simulated 100-500ms latency with retry" },
  { id: "kafka_enriched", label: "enriched-events", position: [5.5, 2.5, 0], color: "#f59e0b", shape: "cylinder", desc: "Kafka Topic: Enriched events ready for downstream consumers" },
];

const CONNECTIONS = [
  { fromId: "producer", toId: "kafka_raw", color: "#3b82f6", flow: "produce" },
  { fromId: "kafka_raw", toId: "consumer", color: "#f59e0b", flow: "consume" },
  { fromId: "consumer", toId: "api", color: "#10b981", flow: "api" },
  { fromId: "consumer", toId: "redis", color: "#ef4444", flow: "redis" },
  { fromId: "consumer", toId: "kafka_enriched", color: "#8b5cf6", flow: "enrich" },
];

const nodePos = (id) => NODES.find(n => n.id === id).position;

const STATUS_COLOR = {
  ENRICHED: "#10b981", DUPLICATE_BLOCKED: "#f59e0b", ERROR: "#ef4444",
  CACHE_HIT: "#3b82f6", CACHE_MISS: "#94a3b8", RETRY: "#a855f7", INFO: "#475569",
};

// ─── 3D: FLOW PARTICLE ────────────────────────────────────────────────────────
function FlowParticle({ from, to, color, active }) {
  const ref = useRef();
  const prog = useRef(0);

  useFrame((_, dt) => {
    if (!active || !ref.current) return;
    prog.current = (prog.current + dt * 0.65) % 1;
    ref.current.position.lerpVectors(
      new THREE.Vector3(...from),
      new THREE.Vector3(...to),
      prog.current
    );
  });

  if (!active) return null;
  return (
    <group ref={ref} position={from}>
      <Sphere args={[0.22, 16, 16]}>
        <meshBasicMaterial color={color} />
      </Sphere>
      <pointLight color={color} intensity={6} distance={4} decay={2} />
    </group>
  );
}

// ─── 3D: ALL LINES + PARTICLES ────────────────────────────────────────────────
function PipelineLinks({ activeFlow }) {
  return (
    <>
      {CONNECTIONS.map((c, i) => {
        const a = nodePos(c.fromId);
        const b = nodePos(c.toId);
        const on = activeFlow === c.flow;
        return (
          <group key={i}>
            <Line
              points={[a, b]}
              color={on ? c.color : "#1e2d45"}
              lineWidth={on ? 2.5 : 1}
              transparent
              opacity={on ? 0.95 : 0.4}
            />
            <FlowParticle from={a} to={b} color={c.color} active={on} />
          </group>
        );
      })}
    </>
  );
}

// ─── 3D: SINGLE NODE ──────────────────────────────────────────────────────────
function PipelineNode({ node, isActive, isHovered, onOver, onOut, onClick }) {
  const inner = useRef();
  const baseY = node.position[1];

  useFrame(({ clock }) => {
    if (!inner.current) return;
    const t = clock.getElapsedTime();
    inner.current.position.y = Math.sin(t * 1.4 + node.position[0]) * 0.09;
    if (node.shape === "box") inner.current.rotation.y = t * 0.35;
  });

  const ei = isActive ? 1.5 : isHovered ? 0.55 : 0.18;
  const scale = isActive ? 1.2 : isHovered ? 1.08 : 1;

  const mat = (
    <meshPhysicalMaterial
      color={node.color} emissive={node.color} emissiveIntensity={ei}
      roughness={0.08} metalness={0.05}
      transmission={0.6} thickness={1.2}
      clearcoat={1} clearcoatRoughness={0.05}
      transparent opacity={0.93}
    />
  );

  return (
    <group
      position={[node.position[0], baseY, node.position[2]]}
      onClick={onClick}
      onPointerOver={onOver}
      onPointerOut={onOut}
    >
      <group ref={inner} scale={[scale, scale, scale]}>
        {node.shape === "box" && <Box args={[1.15, 1.15, 1.15]}>{mat}</Box>}
        {node.shape === "cylinder" && <Cylinder args={[0.9, 0.9, 0.6, 64]} rotation={[Math.PI / 2, 0, 0]}>{mat}</Cylinder>}
        {node.shape === "sphere" && <Sphere args={[0.88, 48, 48]}>{mat}</Sphere>}
        {isActive && (
          <Sphere args={[1.55, 24, 24]}>
            <meshBasicMaterial color={node.color} transparent opacity={0.07} wireframe />
          </Sphere>
        )}
        {isActive && <pointLight color={node.color} intensity={7} distance={5} decay={2} />}
      </group>

      <Html position={[0, -1.72, 0]} center zIndexRange={[100, 0]}>
        <div onClick={onClick} style={{
          background: "rgba(2,6,23,0.92)", backdropFilter: "blur(10px)",
          border: `1px solid ${isActive ? node.color : "rgba(255,255,255,0.1)"}`,
          borderRadius: 20, padding: "5px 13px",
          color: isActive ? node.color : "#e2e8f0",
          fontSize: 11, fontFamily: "'JetBrains Mono',monospace",
          fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer",
          boxShadow: isActive ? `0 0 14px ${node.color}55` : "0 2px 8px rgba(0,0,0,0.5)",
          transition: "all 0.2s", userSelect: "none",
        }}>{node.label}</div>
      </Html>
    </group>
  );
}

// ─── 3D: FULL SCENE ───────────────────────────────────────────────────────────
function Scene({ activeNode, activeFlow, onNodeClick }) {
  const [hov, setHov] = useState(null);
  return (
    <Canvas camera={{ position: [0, 0, 13], fov: 44 }} gl={{ antialias: true }}>
      <color attach="background" args={["#020617"]} />
      <ambientLight intensity={0.35} />
      <spotLight position={[10, 12, 8]} angle={0.2} penumbra={1} intensity={2.5} color="#ffffff" castShadow />
      <spotLight position={[-10, -8, -5]} angle={0.2} penumbra={1} intensity={1.2} color="#3b82f6" />
      <pointLight position={[0, 0, 6]} intensity={0.4} color="#8b5cf6" />

      <OrbitControls
        enableZoom={false} enablePan={false}
        autoRotate autoRotateSpeed={0.3}
        maxPolarAngle={Math.PI / 2 + 0.15}
        minPolarAngle={Math.PI / 3.5}
      />

      <PipelineLinks activeFlow={activeFlow} />

      {NODES.map(n => (
        <PipelineNode
          key={n.id} node={n}
          isActive={activeNode === n.id}
          isHovered={hov === n.id}
          onOver={() => setHov(n.id)}
          onOut={() => setHov(null)}
          onClick={() => onNodeClick(n)}
        />
      ))}
    </Canvas>
  );
}

// ─── UI: STAT CARD ────────────────────────────────────────────────────────────
function StatCard({ label, value, color, icon }) {
  return (
    <div style={{
      background: "rgba(15,23,42,0.6)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 10, padding: "12px 14px",
      position: "relative", overflow: "hidden", flex: 1, minWidth: 0,
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: color, opacity: 0.7 }} />
      <div style={{ fontSize: 18, lineHeight: 1, marginBottom: 5 }}>{icon}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 5, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

// ─── UI: LOG ENTRY ────────────────────────────────────────────────────────────
function LogEntry({ log }) {
  const [open, setOpen] = useState(false);
  const color = STATUS_COLOR[log.type] || "#475569";
  const time = new Date(log.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const icons = { ENRICHED: "✅", DUPLICATE_BLOCKED: "🟡", ERROR: "❌", CACHE_HIT: "⚡", CACHE_MISS: "🔍", RETRY: "🔄", INFO: "ℹ️" };

  return (
    <div
      onClick={() => log.payload && setOpen(o => !o)}
      style={{
        background: "rgba(15,23,42,0.55)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderLeft: `3px solid ${color}`,
        borderRadius: 8, padding: "10px 12px",
        cursor: log.payload ? "pointer" : "default",
        transition: "background 0.15s",
        animation: "logIn 0.25s ease both",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, color: "#334155", fontFamily: "monospace", flexShrink: 0 }}>{time}</span>
        <span style={{
          fontSize: 9, padding: "2px 7px", borderRadius: 20,
          background: `${color}20`, color, fontWeight: 700,
          letterSpacing: "0.06em", fontFamily: "monospace", flexShrink: 0,
        }}>{log.type}</span>
      </div>
      <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.5, marginTop: 4 }}>
        <span style={{ marginRight: 6 }}>{icons[log.type] || "ℹ️"}</span>
        {log.message}
      </div>
      {(log.eventId || log.userId) && (
        <div style={{ fontSize: 10, color: "#334155", marginTop: 3, fontFamily: "monospace" }}>
          {[log.eventId, log.userId].filter(Boolean).join(" · ")}
        </div>
      )}
      {log.payload && open && (
        <pre style={{
          marginTop: 8, background: "#000814", borderRadius: 6,
          padding: "8px 10px", fontSize: 10, color: "#38bdf8",
          overflowX: "auto", fontFamily: "monospace",
          border: "1px solid rgba(56,189,248,0.15)",
        }}>{JSON.stringify(log.payload, null, 2)}</pre>
      )}
    </div>
  );
}

// ─── UI: NODE TOOLTIP ─────────────────────────────────────────────────────────
function NodeTooltip({ node, onClose }) {
  if (!node) return null;
  return (
    <div style={{
      position: "absolute", bottom: 88, left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(10,18,36,0.97)", backdropFilter: "blur(16px)",
      border: `1px solid ${node.color}55`, borderRadius: 12,
      padding: "12px 18px", display: "flex", alignItems: "center", gap: 12,
      zIndex: 30, boxShadow: `0 12px 40px ${node.color}20`,
      minWidth: 280, maxWidth: 380, animation: "fadeUp 0.25s ease",
    }}>
      <div style={{ width: 10, height: 10, borderRadius: "50%", background: node.color, boxShadow: `0 0 10px ${node.color}`, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", marginBottom: 3 }}>{node.label}</div>
        <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>{node.desc}</div>
      </div>
      <button onClick={onClose} style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>✕</button>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [activeNode, setActiveNode] = useState(null);
  const [activeFlow, setActiveFlow] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [metrics, setMetrics] = useState({ processed: 0, enriched: 0, cacheHits: 0, duplicates: 0, errors: 0, apiCalls: 0 });

  const processedIds = useRef(new Set());
  const cachedUsers = useRef({});
  const timers = useRef([]);

  const wait = (ms) => new Promise(r => { const t = setTimeout(r, ms); timers.current.push(t); });

  const addLog = useCallback((type, message, eventId = null, userId = null, payload = null) => {
    setLogs(prev => [{ id: Math.random(), type, message, eventId, userId, payload, ts: Date.now() }, ...prev].slice(0, 100));
  }, []);

  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setLogs([]); setRunning(false);
    setActiveNode(null); setActiveFlow(null);
    processedIds.current.clear();
    cachedUsers.current = {};
    setMetrics({ processed: 0, enriched: 0, cacheHits: 0, duplicates: 0, errors: 0, apiCalls: 0 });
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    processedIds.current.clear();
    cachedUsers.current = {};
    setMetrics({ processed: 0, enriched: 0, cacheHits: 0, duplicates: 0, errors: 0, apiCalls: 0 });
    addLog("INFO", "🚀 Pipeline started — consumer connected to midfield-raw");

    for (const evt of EVENTS) {
      await wait(600);

      // 1. Producer → raw-events
      setActiveNode("producer"); setActiveFlow("produce");
      addLog("INFO", `[Producer] 📨 Sent event: ${evt.eventId} for ${evt.userId}`, evt.eventId, evt.userId, evt);
      await wait(900);

      // 2. Kafka raw-events topic
      setActiveNode("kafka_raw"); setActiveFlow("consume");
      addLog("INFO", `[Kafka] 📬 Topic raw-events received ${evt.eventId}`, evt.eventId);
      await wait(700);

      // 3. Consumer receives
      setActiveNode("consumer"); setActiveFlow("consume");
      setMetrics(m => ({ ...m, processed: m.processed + 1 }));
      addLog("INFO", `[Consumer] 📥 Received ${evt.eventId}`, evt.eventId, evt.userId);
      await wait(500);

      // 4. Idempotency gate → Redis
      setActiveNode("redis"); setActiveFlow("redis");
      await wait(400);

      if (processedIds.current.has(evt.eventId)) {
        setMetrics(m => ({ ...m, duplicates: m.duplicates + 1 }));
        addLog("DUPLICATE_BLOCKED", `[Redis] 🟡 DUPLICATE blocked — ${evt.eventId} already processed`, evt.eventId, evt.userId);
        setActiveNode(null); setActiveFlow(null);
        continue;
      }
      processedIds.current.add(evt.eventId);
      addLog("INFO", `[Redis] ✅ Idempotency gate passed for ${evt.eventId}`, evt.eventId);
      await wait(400);

      // 5. User profile fetch → API
      setActiveNode("api"); setActiveFlow("api");
      const profile = USERS[evt.userId];

      if (cachedUsers.current[evt.userId]) {
        setMetrics(m => ({ ...m, cacheHits: m.cacheHits + 1 }));
        addLog("CACHE_HIT", `[Redis] ⚡ Cache HIT — serving ${evt.userId} instantly`, evt.eventId, evt.userId);
        await wait(350);
      } else if (profile) {
        setMetrics(m => ({ ...m, apiCalls: m.apiCalls + 1 }));
        const latency = Math.round(Math.random() * 400 + 100);
        addLog("CACHE_MISS", `[Cache] 🔍 MISS — fetching ${evt.userId} from User Service…`, evt.eventId, evt.userId);
        await wait(latency);
        cachedUsers.current[evt.userId] = profile;
        addLog("INFO", `[API] ✅ Fetched ${evt.userId} (${latency}ms) → cached for 5m`, evt.eventId, evt.userId, profile);
      } else {
        setMetrics(m => ({ ...m, errors: m.errors + 1 }));
        for (let a = 1; a <= 3; a++) {
          addLog("RETRY", `[API] 🔄 Attempt ${a}/3 — HTTP 404 for ${evt.userId}`, evt.eventId, evt.userId);
          await wait(900 * a);
        }
        addLog("ERROR", `[Pipeline] ❌ Dropped ${evt.eventId} — ${evt.userId} not found after 3 retries`, evt.eventId, evt.userId);
        setActiveNode(null); setActiveFlow(null);
        continue;
      }

      // 6. Enrich + publish
      setActiveNode("consumer"); setActiveFlow("enrich");
      const enriched = { ...evt, user: cachedUsers.current[evt.userId], enrichedAt: new Date().toISOString(), engineVersion: "1.0.0" };
      await wait(400);

      setActiveNode("kafka_enriched"); setActiveFlow("enrich");
      setMetrics(m => ({ ...m, enriched: m.enriched + 1 }));
      addLog("ENRICHED", `[Consumer] ✅ Published Enriched Event: ${evt.eventId}`, evt.eventId, evt.userId, enriched);
      await wait(700);

      setActiveNode(null); setActiveFlow(null);
    }

    await wait(400);
    addLog("INFO", "✅ Pipeline run complete — all events processed");
    setRunning(false);
  }, [running, addLog]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const hitRate = (metrics.cacheHits + metrics.apiCalls) > 0
    ? Math.round(metrics.cacheHits / (metrics.cacheHits + metrics.apiCalls) * 100)
    : 0;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "360px 1fr",
      height: "100vh", width: "100vw",
      fontFamily: "'Inter',system-ui,sans-serif",
      background: "#020617", color: "#f8fafc", overflow: "hidden",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes logIn  {from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeUp {from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes blink  {0%,100%{opacity:1}50%{opacity:0.3}}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:4px}
      `}</style>

      {/* ═══ SIDEBAR ═══ */}
      <aside style={{
        background: "rgba(10,18,36,0.93)", borderRight: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(14px)", display: "flex", flexDirection: "column",
        padding: "20px", gap: 14, overflowY: "auto", height: "100vh",
      }}>
        {/* Header */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.025em", color: "#f1f5f9" }}>Event Enrichment Pipeline</div>
              <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600 }}>Midfield Data Control</div>
            </div>
          </div>
          <p style={{ fontSize: 11, color: "#475569", lineHeight: 1.65 }}>
            Real-time stream processing with Kafka, Redis idempotency, cache-first enrichment, and fault-tolerant retries.
          </p>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={run} disabled={running} style={{
            flex: 1, padding: "9px 0", borderRadius: 8,
            border: `1px solid ${running ? "rgba(59,130,246,0.4)" : "#3b82f6"}`,
            background: running ? "rgba(59,130,246,0.08)" : "#3b82f6",
            color: running ? "#3b82f6" : "#fff",
            fontSize: 12, fontWeight: 700, cursor: running ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s",
          }}>
            {running ? <><span style={{ animation: "blink 1s infinite" }}>◉</span> Running…</> : <>▶ Run Pipeline</>}
          </button>
          <button onClick={reset} style={{
            flex: 1, padding: "9px 0", borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.09)",
            background: "rgba(255,255,255,0.04)", color: "#64748b",
            fontSize: 12, fontWeight: 600, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s",
          }}>↺ Reset Logs</button>
        </div>

        {/* Metric grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <StatCard label="Processed" value={metrics.processed} color="#3b82f6" icon="📥" />
          <StatCard label="Enriched" value={metrics.enriched} color="#10b981" icon="✅" />
          <StatCard label="Cache Hits" value={metrics.cacheHits} color="#06b6d4" icon="⚡" />
          <StatCard label="Duplicates" value={metrics.duplicates} color="#f59e0b" icon="🟡" />
          <StatCard label="Errors" value={metrics.errors} color="#ef4444" icon="❌" />
          <StatCard label="Hit Rate" value={`${hitRate}%`} color="#a855f7" icon="📊" />
        </div>

        {/* Node legend */}
        <div>
          <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, marginBottom: 8 }}>Pipeline Nodes</div>
          {NODES.map(n => (
            <div key={n.id} onClick={() => setSelectedNode(s => s?.id === n.id ? null : n)} style={{
              display: "flex", alignItems: "center", gap: 9,
              padding: "7px 10px", borderRadius: 7, cursor: "pointer",
              background: activeNode === n.id ? `${n.color}12` : "transparent",
              border: `1px solid ${activeNode === n.id ? n.color + "40" : "transparent"}`,
              marginBottom: 2, transition: "all 0.15s",
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: n.color, flexShrink: 0, boxShadow: activeNode === n.id ? `0 0 8px ${n.color}` : "none", transition: "box-shadow 0.2s" }} />
              <span style={{ fontSize: 11, color: activeNode === n.id ? "#e2e8f0" : "#64748b", transition: "color 0.15s" }}>{n.label}</span>
              {activeNode === n.id && <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: n.color, animation: "blink 0.8s infinite" }} />}
            </div>
          ))}
        </div>

        {/* Log feed */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: running ? "#10b981" : "#334155", animation: running ? "blink 1s infinite" : "none" }}>◉</span>
            System Traces
            {logs.length > 0 && <span style={{ marginLeft: "auto", color: "#1e293b", fontSize: 10 }}>{logs.length}</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {logs.length === 0
              ? <div style={{ color: "#1e293b", fontSize: 11, textAlign: "center", marginTop: 28, fontStyle: "italic" }}>No traces yet — click Run Pipeline</div>
              : logs.map(l => <LogEntry key={l.id} log={l} />)
            }
          </div>
        </div>
      </aside>

      {/* ═══ 3D CANVAS ═══ */}
      <div style={{ position: "relative", height: "100vh" }}>
        <Scene activeNode={activeNode} activeFlow={activeFlow} onNodeClick={setSelectedNode} />

        {/* Cluster status */}
        <div style={{
          position: "absolute", top: 20, right: 20,
          background: "rgba(10,18,36,0.9)", backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10,
          padding: "10px 16px", zIndex: 20,
        }}>
          <div style={{ color: "#334155", textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 9, fontWeight: 700, marginBottom: 5 }}>Cluster Status</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, marginBottom: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 8px #10b981", display: "inline-block", animation: "blink 2s infinite" }} />
            <span style={{ color: "#10b981", fontSize: 11 }}>ALL SYSTEMS OPERATIONAL</span>
          </div>
          {["Kafka", "Redis", "API"].map(s => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 5, color: "#475569", fontSize: 10, marginBottom: 2 }}>
              <span style={{ color: "#10b981" }}>●</span> {s}
            </div>
          ))}
        </div>

        {/* Bottom stats bar */}
        <div style={{
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "rgba(10,18,36,0.93)", backdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14,
          padding: "14px 28px", display: "flex", gap: 32, zIndex: 20,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
        }}>
          {[
            { label: "Events Processed", val: metrics.processed, color: "#3b82f6" },
            { label: "Enriched", val: metrics.enriched, color: "#10b981" },
            { label: "Cache Hits", val: metrics.cacheHits, color: "#06b6d4" },
            { label: "Duplicates", val: metrics.duplicates, color: "#f59e0b" },
            { label: "Errors", val: metrics.errors, color: "#ef4444" },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 9, color: "#334155", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 5, fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <NodeTooltip node={selectedNode} onClose={() => setSelectedNode(null)} />
      </div>
    </div>
  );
}