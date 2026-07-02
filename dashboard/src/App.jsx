import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import "./App.css";

// If your backend runs on a different port, change this.
const API_BASE = "http://localhost:3000";

const ALGORITHMS = [
  { key: "fixed-window", label: "Fixed Window", color: "#60a5fa" },
  { key: "sliding-window-counter", label: "Sliding Window", color: "#34d399" },
  { key: "token-bucket", label: "Token Bucket", color: "#fbbf24" },
  { key: "leaky-bucket", label: "Leaky Bucket", color: "#f87171" },
];

function App() {
  const [metrics, setMetrics] = useState({ totals: {}, timeSeries: [] });
  const [selectedAlgo, setSelectedAlgo] = useState("fixed-window");
  const [connected, setConnected] = useState(true);

  // Poll the backend every second — simplest possible "live" dashboard
  // without needing WebSockets for a portfolio-scale project.
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/metrics`);
        const data = await res.json();
        setMetrics(data);
        setConnected(true);
      } catch (err) {
        setConnected(false);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 1000);
    return () => clearInterval(interval);
  }, []);

  const totals = metrics.totals[selectedAlgo] || { allowed: 0, rejected: 0 };
  const totalRequests = totals.allowed + totals.rejected;
  const rejectionRate =
    totalRequests > 0 ? ((totals.rejected / totalRequests) * 100).toFixed(1) : "0.0";

  // Reshape the raw time-series into recharts-friendly rows, one per second,
  // with a flat "allowed"/"rejected" field for the currently selected algorithm.
  const chartData = metrics.timeSeries.map((point) => {
    const algoData = point[selectedAlgo] || { allowed: 0, rejected: 0 };
    const time = new Date(point.timestamp * 1000).toLocaleTimeString();
    return { time, allowed: algoData.allowed, rejected: algoData.rejected };
  });

  const comparisonData = ALGORITHMS.map((algo) => {
    const t = metrics.totals[algo.key] || { allowed: 0, rejected: 0 };
    return { name: algo.label, allowed: t.allowed, rejected: t.rejected };
  });

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Rate Limiter Dashboard</h1>
        <span className={`status-pill ${connected ? "live" : "offline"}`}>
          {connected ? "● Live" : "● Backend unreachable"}
        </span>
      </header>

      <div className="algo-selector">
        {ALGORITHMS.map((algo) => (
          <button
            key={algo.key}
            className={selectedAlgo === algo.key ? "active" : ""}
            style={selectedAlgo === algo.key ? { borderColor: algo.color } : {}}
            onClick={() => setSelectedAlgo(algo.key)}
          >
            {algo.label}
          </button>
        ))}
      </div>

      <div className="stat-cards">
        <div className="stat-card">
          <span className="stat-label">Total Requests</span>
          <span className="stat-value">{totalRequests.toLocaleString()}</span>
        </div>
        <div className="stat-card allowed">
          <span className="stat-label">Allowed</span>
          <span className="stat-value">{totals.allowed.toLocaleString()}</span>
        </div>
        <div className="stat-card rejected">
          <span className="stat-label">Rejected</span>
          <span className="stat-value">{totals.rejected.toLocaleString()}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Rejection Rate</span>
          <span className="stat-value">{rejectionRate}%</span>
        </div>
      </div>

      <div className="chart-panel">
        <h2>Requests per second — {ALGORITHMS.find((a) => a.key === selectedAlgo)?.label}</h2>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
            <XAxis dataKey="time" stroke="#888" tick={{ fontSize: 11 }} />
            <YAxis stroke="#888" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: "#1a1a24", border: "1px solid #333" }}
            />
            <Legend />
            <Line type="monotone" dataKey="allowed" stroke="#34d399" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="rejected" stroke="#f87171" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-panel">
        <h2>Algorithm Comparison — Total Allowed vs Rejected</h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={comparisonData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
            <XAxis dataKey="name" stroke="#888" tick={{ fontSize: 11 }} />
            <YAxis stroke="#888" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: "#1a1a24", border: "1px solid #333" }}
            />
            <Legend />
            <Bar dataKey="allowed" fill="#34d399" />
            <Bar dataKey="rejected" fill="#f87171" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="hint">
        Hit the API with load to see this update live — run a k6 test from the
        project root while this dashboard is open.
      </p>
    </div>
  );
}

export default App;