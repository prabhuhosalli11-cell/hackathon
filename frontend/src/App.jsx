import React, { useState, useEffect, useRef } from 'react';
import { Play, RotateCcw, Activity, Server, ChevronDown, CheckCircle, AlertCircle, Info, RefreshCw, ShieldAlert } from 'lucide-react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Sphere, Cylinder, Trail, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import './App.css';

// ==========================================
// 1. PREMIUM LOG UI COMPONENT
// ==========================================
const LogItem = ({ log }) => {
  const [expanded, setExpanded] = useState(false);

  const getIcon = () => {
    switch (log.type) {
      case 'success': return <CheckCircle size={16} color="#10b981" />;
      case 'error': return <AlertCircle size={16} color="#ef4444" />;
      case 'retry': return <RefreshCw size={16} color="#f59e0b" />;
      case 'warning': return <AlertCircle size={16} color="#f59e0b" />;
      case 'dlq': return <ShieldAlert size={16} color="#ef4444" />;
      default: return <Info size={16} color="#3b82f6" />;
    }
  };

  return (
    <div
      className={`log-card ${log.type}`}
      style={{
        borderLeft: `3px solid var(--color-${log.type === 'dlq' ? 'error' : log.type})`,
        background: log.type === 'dlq' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(2, 6, 23, 0.4)',
      }}
    >
      <div
        className="log-header"
        onClick={() => log.data && setExpanded(!expanded)}
        style={{ cursor: log.data ? 'pointer' : 'default' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {getIcon()}
          <div>
            <div className="log-time" style={{ fontSize: '0.65rem', opacity: 0.7 }}>{log.time}</div>
            <div className="log-msg" style={{ fontSize: '0.85rem' }} dangerouslySetInnerHTML={{ __html: log.msg }} />
          </div>
        </div>
        {log.data && (
          <ChevronDown
            size={16}
            color="rgba(255,255,255,0.5)"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s ease' }}
          />
        )}
      </div>

      <div
        className="log-payload-container"
        style={{
          maxHeight: expanded ? '300px' : '0',
          opacity: expanded ? 1 : 0,
          overflow: 'hidden',
          transition: 'all 0.3s ease'
        }}
      >
        <div className="log-payload" style={{ marginTop: '0.5rem', background: '#000', padding: '0.75rem', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.75rem', color: '#38bdf8' }}>
          {log.data}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 2. CLEAN 3D ARCHITECTURE COMPONENTS
// ==========================================
const nodes = [
  { id: 'producer', label: 'Producer App', position: [-6, 0, 0], color: '#3b82f6', shape: 'box' },
  { id: 'kafka_raw', label: 'raw-events', position: [-2, 1.5, 0], color: '#f59e0b', shape: 'cylinder' },
  { id: 'consumer', label: 'Enrichment Consumer', position: [0, -1, 0], color: '#8b5cf6', shape: 'box' },
  { id: 'redis', label: 'Redis Cache', position: [2, -3, 0], color: '#10b981', shape: 'cylinder' },
  { id: 'api', label: 'User API', position: [-2, -3, 0], color: '#0ea5e9', shape: 'box' },
  { id: 'kafka_enriched', label: 'enriched-events', position: [4, 1.5, 0], color: '#f59e0b', shape: 'cylinder' },
  { id: 'dlq', label: 'Dead Letter Queue', position: [0, -4.5, 0], color: '#ef4444', shape: 'cylinder' }, // Enterprise DLQ added
];

function NodeMesh({ node, activeId }) {
  const meshRef = useRef();
  const isActive = activeId === node.id;

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (meshRef.current) {
      meshRef.current.position.y = node.position[1] + Math.sin(t * 1.5 + node.position[0]) * 0.05;
    }
  });

  const renderShape = () => {
    if (node.shape === 'box') {
      return <RoundedBox args={[1.4, 1.4, 1.4]} radius={0.15} smoothness={4} />;
    }
    return <Cylinder args={[0.9, 0.9, 0.8, 32]} rotation={[0, 0, 0]} />;
  };

  return (
    <group position={node.position} ref={meshRef}>
      {renderShape()}
      {/* Upgraded Material: Fixes the white blob issue */}
      <meshPhysicalMaterial
        color={node.color}
        emissive={node.color}
        emissiveIntensity={isActive ? 1.2 : 0.3}
        roughness={0.2}
        metalness={0.8}
        clearcoat={1}
        clearcoatRoughness={0.1}
      />

      {isActive && (
        <Sphere args={[1.8, 32, 32]}>
          <meshBasicMaterial color={node.color} transparent opacity={0.15} />
        </Sphere>
      )}

      <Html position={[0, -1.4, 0]} center zIndexRange={[100, 0]}>
        <div className="node-tooltip" style={{
          background: 'rgba(2,6,23,0.85)',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '11px',
          border: `1px solid ${node.color}50`,
          whiteSpace: 'nowrap',
          color: 'white'
        }}>
          {node.label}
        </div>
      </Html>
    </group>
  );
}

function FlowParticles({ source, target, color, playSequence }) {
  const meshRef = useRef();

  useFrame((state) => {
    if (!playSequence) return;
    const t = (state.clock.getElapsedTime() * 1.5) % 1;

    if (meshRef.current) {
      meshRef.current.position.lerpVectors(
        new THREE.Vector3(...source),
        new THREE.Vector3(...target),
        t
      );
    }
  });

  if (!playSequence) return null;

  return (
    <Trail width={0.4} length={4} color={new THREE.Color(color)} attenuation={(t) => t * t}>
      <Sphere args={[0.12, 16, 16]} ref={meshRef}>
        <meshBasicMaterial color={color} />
        <pointLight color={color} intensity={2} distance={3} />
      </Sphere>
    </Trail>
  );
}

function Pipeline3D({ activeNode, flow }) {
  return (
    <Canvas camera={{ position: [0, 0, 15], fov: 45 }}>
      <color attach="background" args={['#020617']} />
      {/* Robust Hardcoded Lighting to replace Environment Map */}
      <ambientLight intensity={0.6} />
      <spotLight position={[10, 15, 10]} angle={0.3} penumbra={1} intensity={2} color="#ffffff" castShadow />
      <spotLight position={[-10, -10, -10]} angle={0.3} penumbra={1} intensity={1} color="#3b82f6" />
      <pointLight position={[0, 0, 5]} intensity={0.5} color="#ffffff" />

      <OrbitControls autoRotate autoRotateSpeed={0.5} maxPolarAngle={Math.PI / 2 + 0.1} minPolarAngle={Math.PI / 3} />

      {nodes.map(node => (
        <NodeMesh key={node.id} node={node} activeId={activeNode} />
      ))}

      {/* Particle Routes */}
      <FlowParticles source={[-6, 0, 0]} target={[-2, 1.5, 0]} color="#3b82f6" playSequence={flow === 'produce'} />
      <FlowParticles source={[-2, 1.5, 0]} target={[0, -1, 0]} color="#f59e0b" playSequence={flow === 'consume'} />
      <FlowParticles source={[0, -1, 0]} target={[-2, -3, 0]} color="#0ea5e9" playSequence={flow === 'api'} />
      <FlowParticles source={[0, -1, 0]} target={[2, -3, 0]} color="#10b981" playSequence={flow === 'redis'} />
      <FlowParticles source={[0, -1, 0]} target={[4, 1.5, 0]} color="#f59e0b" playSequence={flow === 'enrich'} />
      <FlowParticles source={[0, -1, 0]} target={[0, -4.5, 0]} color="#ef4444" playSequence={flow === 'dlq'} />
    </Canvas>
  );
}

// ==========================================
// 3. MAIN APPLICATION ORCHESTRATOR
// ==========================================
export default function App() {
  const [logs, setLogs] = useState([]);
  const [activeNode, setActiveNode] = useState(null);
  const [flow, setFlow] = useState(null);
  const [stats, setStats] = useState({ events: 0, enriched: 0, cacheHits: 0, retries: 0, dlq: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const logContainerRef = useRef(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (msg, type = 'info', data = null) => {
    setLogs(prev => [...prev, { id: Date.now() + Math.random(), msg, type, data, time: new Date().toLocaleTimeString() }]);
  };

  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  const runSimulation = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setLogs([]);
    setStats({ events: 0, enriched: 0, cacheHits: 0, retries: 0, dlq: 0 });

    const simEvents = [
      { id: "evt_001", user: "user_001", type: "success" },
      { id: "evt_002", user: "user_002", type: "success" },
      { id: "evt_003", user: "user_999", type: "fail" },
      { id: "evt_004", user: "user_004", type: "success" },
      { id: "evt_002", user: "user_002", type: "duplicate" },
      { id: "evt_005", user: "user_001", type: "cache" }
    ];

    for (const evt of simEvents) {
      setActiveNode('producer');
      setFlow('produce');
      addLog(`[Producer] Sent event: ${evt.id}`, 'info', JSON.stringify({ action: 'purchase', amount: 50 }, null, 2));
      setStats(prev => ({ ...prev, events: prev.events + 1 }));
      await delay(1000);

      setActiveNode('kafka_raw');
      setFlow(null);
      await delay(500);

      setActiveNode('consumer');
      setFlow('consume');
      addLog(`[Consumer] 📥 Received ${evt.id}`, 'info');
      await delay(800);

      setActiveNode('redis');
      setFlow('redis');
      if (evt.type === 'duplicate') {
        addLog(`[Consumer] ♻️ SKIPPED: ${evt.id} already processed`, 'warning');
        await delay(1000);
        continue;
      }
      await delay(800);

      if (evt.type === 'cache') {
        setActiveNode('redis');
        setFlow('redis');
        addLog(`[Consumer] ⚡ Fetched ${evt.user} from Redis Cache`, 'success');
        setStats(prev => ({ ...prev, cacheHits: prev.cacheHits + 1 }));
        await delay(800);
      } else if (evt.type === 'fail') {
        setActiveNode('api');
        setFlow('api');
        for (let i = 1; i <= 3; i++) {
          addLog(`[Consumer] ⚠️ Fetch fail for ${evt.user}, retrying (${i}/3)...`, 'retry');
          setStats(prev => ({ ...prev, retries: prev.retries + 1 }));
          await delay(1000);
        }

        // Architect Upgrade: DLQ Routing
        setActiveNode('dlq');
        setFlow('dlq');
        addLog(`[DLQ] ❌ Permanently failed. Routed ${evt.id} to Dead Letter Queue`, 'dlq', JSON.stringify({ error: "API Timeout", retries_exhausted: true }, null, 2));
        setStats(prev => ({ ...prev, dlq: prev.dlq + 1 }));
        await delay(1500);
        continue;
      } else {
        setActiveNode('api');
        setFlow('api');
        addLog(`[Consumer] 🌐 Fetched ${evt.user} from User API`, 'info', JSON.stringify({ name: "Alex Striker", tier: "Gold" }, null, 2));
        await delay(1500);
      }

      setActiveNode('kafka_enriched');
      setFlow('enrich');
      addLog(`[Consumer] 📤 Published Enriched Event: ${evt.id}`, 'success');
      setStats(prev => ({ ...prev, enriched: prev.enriched + 1 }));
      await delay(1500);
    }

    setActiveNode(null);
    setFlow(null);
    addLog('✅ [Simulation Complete] Pipeline idle.', 'success');
    setIsRunning(false);
  };

  // Gamification/Insights metric
  const successRate = stats.events > 0 ? Math.round(((stats.enriched + stats.cacheHits) / (stats.events - (stats.events - (stats.enriched + stats.cacheHits + stats.dlq)))) * 100) || 0 : 0;

  return (
    <div className="dashboard-container" style={{ display: 'flex', height: '100vh', width: '100vw', background: '#020617', color: 'white', overflow: 'hidden' }}>
      <div className="sidebar" style={{ width: '400px', borderRight: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', padding: '1.5rem', zIndex: 10, background: 'rgba(15, 23, 42, 0.8)' }}>
        <div>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem 0' }}>Event Enrichment Pipeline</h1>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '2rem' }}>Enterprise stream processing with intelligent routing, idempotency, and Dead Letter Queue fault tolerance.</p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem' }}>
          <button onClick={runSimulation} disabled={isRunning} style={{ flex: 1, padding: '0.6rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: isRunning ? 'not-allowed' : 'pointer', opacity: isRunning ? 0.5 : 1 }}>
            <Play size={14} /> {isRunning ? "Processing..." : "Run Pipeline"}
          </button>
          <button onClick={() => setLogs([])} disabled={isRunning} style={{ flex: 1, padding: '0.6rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
            <RotateCcw size={14} /> Clear
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#94a3b8', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={14} color="#3b82f6" /> System Traces
          </div>
          <div className="log-list" ref={logContainerRef} style={{ flex: 1, overflowY: 'auto', paddingRight: '0.5rem' }}>
            {logs.length === 0 ? <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.85rem' }}>Awaiting events...</div> : logs.map(log => <LogItem key={log.id} log={log} />)}
          </div>
        </div>
      </div>

      <div className="canvas-container" style={{ flex: 1, position: 'relative' }}>
        <Pipeline3D activeNode={activeNode} flow={flow} />

        <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'rgba(15,23,42,0.8)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
            <Server size={14} color="#10b981" /> Cluster Status
          </div>
          <div style={{ color: '#10b981', fontSize: '0.75rem', fontWeight: 'bold' }}>● HEALTHY</div>
        </div>

        <div style={{ position: 'absolute', bottom: '2rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '2rem', background: 'rgba(15,23,42,0.9)', padding: '1.2rem 2.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{stats.events}</div>
            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8' }}>Processed</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#8b5cf6' }}>{stats.enriched}</div>
            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8' }}>Enriched</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ef4444' }}>{stats.dlq}</div>
            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8' }}>DLQ Drops</div>
          </div>
          <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '2rem' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: successRate > 90 ? '#10b981' : successRate > 70 ? '#f59e0b' : '#ef4444' }}>
              {successRate}%
            </div>
            <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#94a3b8' }}>Success Rate</div>
          </div>
        </div>
      </div>
    </div>
  );
}