import express from "express";
import dotenv from "dotenv";
import { rateLimiter } from "./middleware.js";
import { getMetricsSnapshot } from "./metrics.js";

dotenv.config();

const app = express();

// The dashboard runs on a different port (Vite dev server, e.g. :5173)
// during development, so the browser needs CORS permission to poll this API.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  next();
});

// Route protected by Fixed Window: 10 requests per 30 seconds per IP
app.get(
  "/api/fixed",
  rateLimiter({ algorithm: "fixed-window", limit: 10, windowSeconds: 30 }),
  (req, res) => {
    res.json({ message: "success", algorithm: "fixed-window" });
  }
);

// Route protected by Sliding Window: 10 requests per 30 seconds per IP
app.get(
  "/api/sliding",
  rateLimiter({ algorithm: "sliding-window", limit: 10, windowSeconds: 30 }),
  (req, res) => {
    res.json({ message: "success", algorithm: "sliding-window" });
  }
);

// Route protected by Token Bucket: capacity 10, refills 1 token every 3 seconds
// Allows bursts up to 10 requests, then throttles to ~1 request per 3s
app.get(
  "/api/token-bucket",
  rateLimiter({ algorithm: "token-bucket", capacity: 10, refillRate: 1 / 3 }),
  (req, res) => {
    res.json({ message: "success", algorithm: "token-bucket" });
  }
);

// Route protected by Leaky Bucket: capacity 10, leaks (processes) 1 unit every 3 seconds
// No bursts allowed — smooths everything to a constant rate
app.get(
  "/api/leaky-bucket",
  rateLimiter({ algorithm: "leaky-bucket", capacity: 10, leakRate: 1 / 3 }),
  (req, res) => {
    res.json({ message: "success", algorithm: "leaky-bucket" });
  }
);

// Dashboard polls this endpoint to render live charts.
app.get("/api/metrics", (req, res) => {
  res.json(getMetricsSnapshot());
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Rate limiter demo server running on http://localhost:${PORT}`);
  console.log(`Try: curl http://localhost:${PORT}/api/fixed`);
});