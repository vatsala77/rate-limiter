import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

/**
 * Usage:
 *   k6 run k6-tests/loadtest.js -e ALGO=fixed
 *   k6 run k6-tests/loadtest.js -e ALGO=sliding
 *   k6 run k6-tests/loadtest.js -e ALGO=token-bucket
 *   k6 run k6-tests/loadtest.js -e ALGO=leaky-bucket
 *
 * ALGO maps to the endpoint path suffix (matches routes in src/server.js).
 * Make sure `npm start` is running in another terminal before running this.
 */

const ALGO = __ENV.ALGO || "fixed";
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

const ENDPOINTS = {
  fixed: "/api/fixed",
  sliding: "/api/sliding",
  "token-bucket": "/api/token-bucket",
  "leaky-bucket": "/api/leaky-bucket",
};

const URL = `${BASE_URL}${ENDPOINTS[ALGO]}`;

// Custom metrics — these are what let us count allowed vs rejected
// requests separately, on top of k6's built-in latency percentiles.
const allowedCount = new Counter("requests_allowed");
const rejectedCount = new Counter("requests_rejected");

// Ramp profile: start small, climb past the configured limit, then hold.
// This simulates a client that starts polite and then bursts — exactly
// the scenario a rate limiter needs to prove it handles correctly.
export const options = {
  stages: [
    { duration: "10s", target: 5 },   // warm up: below the limit
    { duration: "15s", target: 30 },  // ramp up: exceed the limit
    { duration: "15s", target: 30 },  // hold: sustained overload
    { duration: "5s", target: 0 },    // cool down
  ],
  thresholds: {
    // Fail the test run if p95 latency ever exceeds 500ms — a
    // reasonable ceiling for a Redis-backed check + Lua script.
    http_req_duration: ["p(95)<500"],
  },
};

export default function () {
  const res = http.get(URL);

  check(res, {
    "status is 200 or 429": (r) => r.status === 200 || r.status === 429,
  });

  if (res.status === 200) {
    allowedCount.add(1);
  } else if (res.status === 429) {
    rejectedCount.add(1);
  }

  sleep(0.1); // small pause so each VU fires ~10 req/s, not a tight spin loop
}