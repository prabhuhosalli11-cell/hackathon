import React, { useState, useEffect, useRef } from 'react';
import { Play, RotateCcw, Activity, Server, Database } from 'lucide-react';
import Pipeline3D from './components/Pipeline3D';

function App() {
  const [logs, setLogs] = useState([]);
  const [activeNode, setActiveNode] = useState(null);
  const [flow, setFlow] = useState(null);
  const [stats, setStats] = useState({ events: 0, enriched: 0, cacheHits: 0, retries: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const logContainerRef = useRef(null);

  // Auto-scroll logs
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
    setStats({ events: 0, enriched: 0, cacheHits: 0, retries: 0 });

    const simEvents = [
      { id: "evt_001", user: "user_001", type: "success" },
      { id: "evt_002", user: "user_002", type: "success" },
      { id: "evt_003", user: "user_999", type: "fail" },
      { id: "evt_004", user: "user_004", type: "success" },
      { id: "evt_002", user: "user_002", type: "duplicate" }, // Induce idempotency
      { id: "evt_005", user: "user_001", type: "cache" } // Induce cache hit
    ];

    for (const evt of simEvents) {
      // 1. Produce
      setActiveNode('producer');
      setFlow('produce');
      addLog(`[Producer] Sent event: ${evt.id} for user ${evt.user}`, 'info', JSON.stringify({ action: 'purchase', amount: 50 }));
      setStats(prev => ({ ...prev, events: prev.events + 1 }));
      await delay(1000);

      // 2. Kafka Raw
      setActiveNode('kafka_raw');
      setFlow(null);
      await delay(500);

      // 3. Consumer receives
      setActiveNode('consumer');
      setFlow('consume');
      addLog(`[Consumer] 📥 Received ${evt.id}`, 'info');
      await delay(800);

      // 4. Redis Idempotency Check
      setActiveNode('redis');
      setFlow('redis');
      if (evt.type === 'duplicate') {
        addLog(`[Consumer] ♻️ SKIPPED: ${evt.id} already processed (Idempotency)`, 'warning');
        await delay(1000);
        continue;
      }
      await delay(800);

      // 5. Fetch/Enrich
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
        addLog(`[Consumer] ❌ ERROR: Failed to fetch user data after 3 attempts`, 'error');
        await delay(1000);
        continue;
      } else {
        setActiveNode('api');
        setFlow('api');
        addLog(`[Consumer] 🌐 Fetched ${evt.user} from User Service API`, 'info', JSON.stringify({ name: "Alex Striker", tier: "Gold" }));
        await delay(1500);
      }

      // 6. Enriched
      setActiveNode('kafka_enriched');
      setFlow('enrich');
      addLog(`[Consumer] 📤 Published Enriched Event: ${evt.id}`, 'success');
      setStats(prev => ({ ...prev, enriched: prev.enriched + 1 }));
      await delay(1500);
    }

    setActiveNode(null);
    setFlow(null);
    addLog('✅ [Simulation Complete] All events processed.', 'success');
    setIsRunning(false);
  };

  return (
    <div className="dashboard-container">
      {/* LEFT SIDEBAR PANEL */}
      <div className="sidebar">
        <div className="header">
          <h1>Kafka Event Enrichment</h1>
          <p>Real-time stream processing architecture demonstrating intelligent scaling, idempotency, and fault tolerance.</p>
        </div>

        <div className="controls">
          <button className="btn btn-primary" onClick={runSimulation} disabled={isRunning}>
            <Play size={14} /> {isRunning ? "Running..." : "Run Simulation"}
          </button>
          <button className="btn" onClick={() => setLogs([])} disabled={isRunning}>
            <RotateCcw size={14} /> Clear
          </button>
        </div>

        <div className="log-panel" style={{ marginTop: '2rem' }}>
          <div className="log-title">
            <Activity size={14} color="var(--accent-blue)" /> Live Pipeline Logs
          </div>
          <div className="log-list" ref={logContainerRef}>
            {logs.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontStyle: 'italic', marginTop: '1rem' }}>
                Waiting for events... Click 'Run Simulation' to start.
              </div>
            ) : logs.map((log) => (
              <div key={log.id} className={`log-item ${log.type}`}>
                <div className="log-meta">
                  <span>{log.time}</span>
                  <span style={{ textTransform: 'uppercase', fontSize: '0.65rem', opacity: 0.7 }}>{log.type}</span>
                </div>
                <div className="log-msg" dangerouslySetInnerHTML={{ __html: log.msg }} />
                {log.data && (
                  <div className="log-data" style={{ marginTop: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '4px' }}>
                    {log.data}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3D VISUALIZATION CANVAS */}
      <div className="canvas-container">
        <Pipeline3D activeNode={activeNode} flow={flow} />
        
        {/* Overlays */}
        <div className="overlay overlay-tr">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <Server size={14} color="var(--accent-green)" /> Architecture Status
          </div>
          <div style={{ color: 'var(--accent-green)', fontSize: '0.75rem' }}>● All Systems Operational</div>
        </div>

        <div className="overlay overlay-bm">
          <div className="stat">
            <div className="stat-val">{stats.events}</div>
            <div className="stat-label">Events Processed</div>
          </div>
          <div className="stat">
            <div className="stat-val" style={{ color: 'var(--accent-purple)' }}>{stats.enriched}</div>
            <div className="stat-label">Enriched</div>
          </div>
          <div className="stat">
            <div className="stat-val" style={{ color: 'var(--accent-green)' }}>{stats.cacheHits}</div>
            <div className="stat-label">Cache Hits</div>
          </div>
          <div className="stat">
            <div className="stat-val" style={{ color: 'var(--accent-red)' }}>{stats.retries}</div>
            <div className="stat-label">API Retries</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
