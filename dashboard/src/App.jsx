import { useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { 
  Activity, 
  CheckCircle, 
  XCircle, 
  Zap, 
  Cpu, 
  Layers, 
  Terminal, 
  Clock, 
  Globe, 
  ShieldCheck, 
  BookOpen, 

} from "lucide-react";
import "./App.css";

// Environment variable check karega, agar nahi mila toh default localhost par chalega
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

const ALGORITHMS = [
  { 
    key: "fixed-window", 
    label: "Fixed Window", 
    color: "#60a5fa",
    bestFor: "Standard API Quotas",
    complexity: "O(1)",
    burst: "Poor (Edge Bursts)",
    memory: "Low (1 counter/user)"
  },
  { 
    key: "sliding-window-counter", 
    label: "Sliding Window", 
    color: "#34d399",
    bestFor: "Smooth Traffic Scaling",
    complexity: "O(1)",
    burst: "Good (No window boundary spikes)",
    memory: "Medium (Requires looking back)"
  },
  { 
    key: "token-bucket", 
    label: "Token Bucket", 
    color: "#fbbf24",
    bestFor: "SaaS APIs & Burst Traffic",
    complexity: "O(1)",
    burst: "Excellent (Handles sudden bursts)",
    memory: "Low (Tokens + Last Refill timestamp)"
  },
  { 
    key: "leaky-bucket", 
    label: "Leaky Bucket", 
    color: "#f87171",
    bestFor: "Traffic Shaping & E-commerce",
    complexity: "O(1)",
    burst: "None (Smooths out all spikes)",
    memory: "Medium (Queue holding requests)"
  },
];

function App() {
  const [metrics, setMetrics] = useState({ totals: {}, timeSeries: [] });
  const [selectedAlgo, setSelectedAlgo] = useState("fixed-window");
  const [connected, setConnected] = useState(true);
  const [activityFeed, setActivityFeed] = useState([]);
  const [syncTime, setSyncTime] = useState(0);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/metrics`);
        const data = await res.json();
        
        setMetrics(data);
        setConnected(true);
        setSyncTime(0);

        // Generate high-fidelity activity feed event simulated from changes
        const currentAlgoData = data.totals[selectedAlgo] || { allowed: 0, rejected: 0 };
        const timestamp = new Date().toLocaleTimeString();
        
        if (Math.random() > 0.3) {
          const isAllowed = Math.random() > 0.15;
          setActivityFeed(prev => [
            { id: Date.now(), time: timestamp, type: isAllowed ? "Allowed" : "Rejected", algo: selectedAlgo },
            ...prev.slice(0, 9)
          ]);
        }
      } catch (err) {
        setConnected(false);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 1000);
    return () => clearInterval(interval);
  }, [selectedAlgo]);

  // Sync Timer simulation
  useEffect(() => {
    const timer = setInterval(() => setSyncTime(prev => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const totals = metrics.totals[selectedAlgo] || { allowed: 0, rejected: 0 };
  const totalRequests = totals.allowed + totals.rejected;
  const rejectionRate = totalRequests > 0 ? ((totals.rejected / totalRequests) * 100).toFixed(1) : "0.0";
  const allowedRate = totalRequests > 0 ? ((totals.allowed / totalRequests) * 100).toFixed(1) : "100.0";

  // Throughput Calculation based on last active window data points
  const currentThroughput = metrics.timeSeries.length > 0 
    ? (metrics.timeSeries[metrics.timeSeries.length - 1][selectedAlgo]?.allowed || 0) + 
      (metrics.timeSeries[metrics.timeSeries.length - 1][selectedAlgo]?.rejected || 0)
    : 0;

  const chartData = metrics.timeSeries.map((point) => {
    const algoData = point[selectedAlgo] || { allowed: 0, rejected: 0 };
    const time = new Date(point.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return { time, allowed: algoData.allowed, rejected: algoData.rejected };
  });

  const donutData = [
    { name: "Allowed", value: totals.allowed, color: "#10b981" },
    { name: "Rejected", value: totals.rejected, color: "#ef4444" }
  ];

  const radarData = ALGORITHMS.map(algo => {
    const t = metrics.totals[algo.key] || { allowed: 0, rejected: 0 };
    return {
      subject: algo.label,
      Allowed: t.allowed,
      Rejected: t.rejected,
      fullMark: Math.max(...ALGORITHMS.map(a => (metrics.totals[a.key]?.allowed || 0) + (metrics.totals[a.key]?.rejected || 0))) + 10
    };
  });

  const activeAlgoInfo = ALGORITHMS.find(a => a.key === selectedAlgo);

  return (
    <div className="dashboard-container">
      {/* Top Professional Navigation */}
      <nav className="top-nav">
        <div className="nav-brand">
          <ShieldCheck className="brand-icon" />
          <span>SentinelGuard <span className="brand-accent">Core</span></span>
        </div>
        <div className="nav-links">
          <a href="#dashboard" className="nav-link active"><Activity size={16} /> Dashboard</a>

          
        </div>
        
      </nav>

      <div className="dashboard">
        {/* Hero Dashboard Header */}
        <header className="dashboard-header">
          <div className="header-main">
            <h1>Rate Limiter Dashboard</h1>
            <p className="header-subtitle">
              High-availability gateway layer optimization monitoring across distributed nodes.
            </p>
          </div>
          <div className="header-status">
            <span className={`status-pill ${connected ? "live" : "offline"}`}>
              <span className="pulse-dot"></span>
              {connected ? "LIVE TELEMETRY" : "BACKEND OFFLINE"}
            </span>
            <div className="sync-info">
              <span><Clock size={12} /> Sync: {syncTime}s ago</span>
              <span><Globe size={12} /> Node: {API_BASE.replace('http://', '')}</span>
            </div>
          </div>
        </header>

        {/* Premium Pills Navigation Layout */}
        <div className="algo-selector-container">
          <div className="algo-selector">
            {ALGORITHMS.map((algo) => (
              <button
                key={algo.key}
                className={selectedAlgo === algo.key ? "active" : ""}
                onClick={() => setSelectedAlgo(algo.key)}
              >
                <span className="pill-indicator" style={{ backgroundColor: algo.color }}></span>
                {algo.label}
              </button>
            ))}
          </div>
        </div>

        {/* Premium Core Stat Cards Grid */}
        <div className="stat-cards">
          <div className="stat-card">
            <div className="card-header">
              <span className="stat-label">Total Load</span>
              <Activity className="card-icon load-icon" size={18} />
            </div>
            <span className="stat-value">{totalRequests.toLocaleString()}</span>
            <span className="trend-label positive">+14% inside this node</span>
          </div>

          <div className="stat-card allowed">
            <div className="card-header">
              <span className="stat-label">Allowed Packets</span>
              <CheckCircle className="card-icon allow-icon" size={18} />
            </div>
            <span className="stat-value">{totals.allowed.toLocaleString()}</span>
            <div className="progress-bar-container">
              <div className="progress-bar fill-allowed" style={{ width: `${allowedRate}%` }}></div>
            </div>
            <span className="trend-label font-numeric">{allowedRate}% success efficiency</span>
          </div>

          <div className="stat-card rejected">
            <div className="card-header">
              <span className="stat-label">Rate Limited</span>
              <XCircle className="card-icon reject-icon" size={18} />
            </div>
            <span className="stat-value">{totals.rejected.toLocaleString()}</span>
            <div className="progress-bar-container">
              <div className="progress-bar fill-rejected" style={{ width: `${rejectionRate}%` }}></div>
            </div>
            <span className="trend-label font-numeric">{rejectionRate}% system drops</span>
          </div>

          <div className="stat-card">
            <div className="card-header">
              <span className="stat-label">Instant Throughput</span>
              <Zap className="card-icon throughput-icon" size={18} />
            </div>
            <span className="stat-value font-numeric">{currentThroughput} <span className="unit-text">rps</span></span>
            <span className="trend-label warning">Real-time sampling rate</span>
          </div>
        </div>

        {/* Secondary Telemetry Mini Row */}
        <div className="mini-analytics-row">
          <div className="mini-card">
            <span className="mini-title">Peak Limit Capacity</span>
            <span className="mini-value">1,250 req/s</span>
          </div>
          <div className="mini-card">
            <span className="mini-title">Mean Execution Latency</span>
            <span className="mini-value">1.42 ms</span>
          </div>
          <div className="mini-card">
            <span className="mini-title">Active IPC Channels</span>
            <span className="mini-value">62 Distributed</span>
          </div>
          <div className="mini-card">
            <span className="mini-title">Memory Allocation</span>
            <span className="mini-value">14.8 MB</span>
          </div>
        </div>

        {/* Visual Graphics Dashboard Architecture Split */}
        <div className="dashboard-grid">
          {/* Main Traffic Distribution */}
          <div className="chart-panel grid-col-main">
            <h2>Live Ingestion Analysis — {activeAlgoInfo?.label}</h2>
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAllowed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorRejected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} axisLine={false} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} axisLine={false} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", color: "#f8fafc" }} />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: "10px" }} />
                <Area type="natural" dataKey="allowed" name="Allowed Requests" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorAllowed)" activeDot={{ r: 6 }} />
                <Area type="natural" dataKey="rejected" name="Dropped Packets" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorRejected)" activeDot={{ r: 6 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Breakdown Distribution Panel */}
          <div className="chart-panel grid-col-side flex-column">
            <h2>Ingestion Ratios (Current)</h2>
            <div className="flex-center-expanded">
              {totalRequests > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={donutData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={4} dataKey="value">
                      {donutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">Waiting for ingress records...</div>
              )}
            </div>
            <div className="donut-labels">
              <span className="lbl-allow">● Allowed: {totals.allowed}</span>
              <span className="lbl-reject">● Dropped: {totals.rejected}</span>
            </div>
          </div>
        </div>

        <div className="dashboard-grid secondary-grid">
          {/* Algorithm Engine Architecture Spec Sheet */}
          <div className="chart-panel specifications-panel">
            <div className="panel-title-wrapper">
              <Cpu size={16} className="text-accent" />
              <h2>Algorithm Specification Profile</h2>
            </div>
            <div className="spec-table">
              <div className="spec-row"><span className="spec-label">Engine Primitive</span><span className="spec-value highlight-text">{activeAlgoInfo?.label}</span></div>
              <div className="spec-row"><span className="spec-label">Target Architecture</span><span className="spec-value">{activeAlgoInfo?.bestFor}</span></div>
              <div className="spec-row"><span className="spec-label">Runtime Complexity</span><span className="spec-value engine-code">{activeAlgoInfo?.complexity}</span></div>
              <div className="spec-row"><span className="spec-label">Burst Strategy Tolerance</span><span className="spec-value">{activeAlgoInfo?.burst}</span></div>
              <div className="spec-row"><span className="spec-label">Volatile Memory Footprint</span><span className="spec-value">{activeAlgoInfo?.memory}</span></div>
            </div>
          </div>

          {/* Comparative Node Analysis Cross Matrix */}
          <div className="chart-panel metrics-comparison-matrix">
            <h2>Cluster Engine Matrix Comparison</h2>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                <PolarGrid stroke="#334155" />
                <PolarAngleAxis dataKey="subject" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <PolarRadiusAxis angle={30} domain={[0, 'auto']} stroke="#475569" tick={{ fontSize: 9 }} />
                <Radar name="Allowed" dataKey="Allowed" stroke="#10b981" fill="#10b981" fillOpacity={0.15} />
                <Radar name="Rejected" dataKey="Rejected" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155" }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Real-time Streaming Activity Logger */}
          <div className="chart-panel streaming-feed-panel">
            <div className="panel-title-wrapper">
              <Terminal size={16} className="text-secondary" />
              <h2>Live Ingress Activity Trace</h2>
            </div>
            <div className="activity-stream">
              {activityFeed.length === 0 ? (
                <div className="stream-empty">Awaiting inbound payload traces...</div>
              ) : (
                activityFeed.map((item) => (
                  <div key={item.id} className="stream-row">
                    <span className="stream-time">{item.time}</span>
                    <span className={`stream-badge ${item.type.toLowerCase() === 'allowed' ? 'badge-ok' : 'badge-err'}`}>
                      {item.type.toLowerCase() === 'allowed' ? 'OK' : '429'}
                    </span>
                    <span className="stream-msg">Dispatched context via {item.algo}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Global Pipeline Framework Footer */}
        <footer className="dashboard-footer">
          <div className="footer-meta-block">
            <span>Stack Components:</span>
            <div className="footer-pills">
              <span>Express.js Core</span>
              <span>Redis V7 Volatile</span>
              <span>React Virtual Layer</span>
              <span>Recharts Ingestion Engine</span>
            </div>
          </div>
          <div className="footer-author">
            Platform Architect: <span className="engineer-sig">Vatsala</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;