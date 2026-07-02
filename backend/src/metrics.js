/**
 * Lightweight in-memory metrics store.
 *
 * Why in-memory and not Redis: this is purely for the live dashboard view,
 * not for the rate-limit decision itself (that's Redis, for correctness
 * across instances). Losing dashboard history on a server restart is fine;
 * losing rate-limit state would not be. Keeping this separate is itself a
 * design choice worth mentioning: don't mix your source-of-truth state
 * with your observability state.
 */

const HISTORY_WINDOW_SECONDS = 60; // how much history the dashboard chart shows

// counters[algorithm] = { allowed: n, rejected: n }
const counters = {};

// timeSeries: one entry per second, holding counts per algorithm for that second
// [{ timestamp, "fixed-window": {allowed, rejected}, "token-bucket": {...}, ... }]
const timeSeries = [];

function ensureAlgo(algo) {
  if (!counters[algo]) counters[algo] = { allowed: 0, rejected: 0 };
}

function currentSecondBucket() {
  const nowSecond = Math.floor(Date.now() / 1000);
  let bucket = timeSeries[timeSeries.length - 1];
  if (!bucket || bucket.timestamp !== nowSecond) {
    bucket = { timestamp: nowSecond };
    timeSeries.push(bucket);
    // trim old history so this array doesn't grow forever
    while (timeSeries.length > HISTORY_WINDOW_SECONDS) {
      timeSeries.shift();
    }
  }
  return bucket;
}

export function recordRequest(algorithm, allowed) {
  ensureAlgo(algorithm);
  counters[algorithm][allowed ? "allowed" : "rejected"]++;

  const bucket = currentSecondBucket();
  if (!bucket[algorithm]) bucket[algorithm] = { allowed: 0, rejected: 0 };
  bucket[algorithm][allowed ? "allowed" : "rejected"]++;
}

export function getMetricsSnapshot() {
  return {
    totals: counters,
    timeSeries: timeSeries.map((b) => ({
      timestamp: b.timestamp,
      ...Object.fromEntries(
        Object.keys(counters).map((algo) => [
          algo,
          b[algo] || { allowed: 0, rejected: 0 },
        ])
      ),
    })),
  };
}