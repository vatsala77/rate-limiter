# Distributed Rate Limiter

## 🔗 Live Demo

**Dashboard:** https://rate-limiter-eta.vercel.app/
**API:** https://rate-limiter-l8yi.onrender.com/api/fixed

> Note: the backend runs on Render's free tier, which sleeps after 15 minutes
> of inactivity. The first request after idle can take 30–50 seconds to wake
> up — this is a Render free-tier limitation, not a bug in the rate limiter.

A Redis-backed, multi-algorithm rate limiter built as reusable Express middleware.
Designed to demonstrate distributed systems concepts: atomicity, race conditions,
and failure-mode tradeoffs — not just a working demo.

## Why this exists

Most rate limiter tutorials use a single in-memory counter, which breaks the moment
you run more than one server instance. This one uses Redis as shared state so the
limit is enforced correctly across N instances of your API.

## How to Test This

You don't need to download or install anything — this works against the live
website and live API directly from your terminal.

**Step 1: Open the dashboard**
Go to https://rate-limiter-eta.vercel.app/ and keep this tab open. This is
where you'll see live numbers update.

**Step 2: Open a terminal**
- On Mac/Linux: open the Terminal app.
- On Windows: open PowerShell (search "PowerShell" in the Start menu).

**Step 3: Send one request and see it work**

Mac/Linux (bash):
```bash
curl -i https://rate-limiter-l8yi.onrender.com/api/fixed
```

Windows (PowerShell):
```powershell
curl.exe -i https://rate-limiter-l8yi.onrender.com/api/fixed
```

> First request may take 30–50 seconds — the free server "sleeps" when
> nobody uses it for a while and needs a moment to wake up. This is normal.

You should see a response like:
```
HTTP/1.1 200 OK
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
{"message":"success","algorithm":"fixed-window"}
```
`X-RateLimit-Remaining` tells you how many requests you have left before
you get blocked.

**Step 4: Trigger the actual rate limit**

The limit is 10 requests every 30 seconds. Send more than 10 requests quickly
and watch it start blocking you:

Mac/Linux (bash):
```bash
for i in {1..12}; do curl -i https://rate-limiter-l8yi.onrender.com/api/fixed; echo; done
```

Windows (PowerShell):
```powershell
1..12 | ForEach-Object { curl.exe -i https://rate-limiter-l8yi.onrender.com/api/fixed }
```

What to expect: the first 10 requests return `200 OK` (success). Requests
11 and 12 return `429 Too Many Requests` — this is the rate limiter doing
its job, blocking you once you go over the limit.

**Step 5: Try the other 3 algorithms**
Same idea, just swap the URL path:
```
https://rate-limiter-l8yi.onrender.com/api/sliding
https://rate-limiter-l8yi.onrender.com/api/token-bucket
https://rate-limiter-l8yi.onrender.com/api/leaky-bucket
```

**Step 6: See the raw numbers behind the dashboard**
```bash
curl https://rate-limiter-l8yi.onrender.com/api/metrics
```
This returns the same data the dashboard charts are built from — total
requests allowed/rejected per algorithm, and a per-second history.

**Step 7 (optional): Read the code**
If you want to see how it's built rather than just test it, start here:
- `src/middleware.js` — the entry point, decides which algorithm to run
- `src/algorithms/` — each algorithm's logic (Fixed Window, Sliding Window, Token Bucket, Leaky Bucket)
- `src/redisClient.js` — how it talks to Redis safely (atomic operations, reconnect handling)

## How to Run This Locally

```bash
npm install
cp .env.example .env
# fill in UPSTASH_REDIS_URL from https://console.upstash.com
npm start
```

Test it:
```bash
curl http://localhost:3000/api/fixed
curl http://localhost:3000/api/sliding
```

## Algorithms implemented

| Algorithm | Memory | Accuracy | Allows bursts? | Used by |
|---|---|---|---|---|
| Fixed Window | O(1) per key | Low (boundary burst issue) | Yes, at window edges (bug) | Simple APIs |
| Sliding Window Counter | O(1) per key | High (weighted approximation) | No | Cloudflare, most production systems |
| Token Bucket | O(1) per key | High | Yes, intentionally | Stripe, AWS API Gateway |
| Leaky Bucket | O(1) per key | High | No, smooths to fixed rate | Network traffic shaping |

## Design decisions worth asking me about in an interview

**1. Why Lua scripts instead of plain Redis commands?**
A naive implementation does `GET` then `INCR` as two separate round trips. Between
those two calls, another request can slip in and read the same stale count —
a classic race condition, and under real concurrent load it lets more requests
through than the limit allows. Every algorithm here does its read-check-write
as a single Lua script (`EVALSHA`), which Redis executes atomically on the
server — no interleaving possible, and it's one network round trip instead of two.

**2. Fail-open vs fail-closed**
If Redis itself goes down, what should happen to your API?
- `fail-open`: let requests through. Prioritizes uptime. Default here — most
  APIs would rather serve traffic unprotected for a few minutes than go fully down.
- `fail-closed`: reject everything. Use this for abuse-sensitive endpoints like
  login or payment, where letting unlimited requests through during an outage
  is more dangerous than a temporary 503.

Configurable via `FAILURE_MODE` in `.env` or per-route in the middleware config.

**3. The boundary-burst problem**
Fixed Window counts requests in a fixed 60-second block. A client can send
the full quota in the last second of one window and again in the first second
of the next — 2x the intended limit in ~2 real seconds. Sliding Window Counter
fixes this by blending in a weighted portion of the previous window's count.

**4. Hot key problem (known limitation, not yet solved here)**
If a single identifier (e.g. one very active user) generates huge traffic,
its Redis key becomes a hotspot on one Redis node. Not an issue at small
scale; at large scale this is typically solved with local + distributed
two-tier limiting (approximate locally, sync to Redis periodically) rather
than hitting Redis on every single request.

## Architecture

```
Client request
      |
      v
Express middleware (src/middleware.js)
      |  picks algorithm via strategy pattern
      v
Algorithm module (src/algorithms/*.js)
      |  runs atomic Lua script
      v
Redis (Upstash) -- shared state across all server instances
```

## Benchmark Results (k6 load test)

Tested locally: 45s run, ramping from 5 to 30 concurrent virtual users, against
a limit/capacity of 10 per algorithm. Full methodology in `k6-tests/loadtest.js`.

| Algorithm | Throughput | Avg Latency | p95 Latency | Requests Allowed | Requests Rejected |
|---|---|---|---|---|---|
| Fixed Window | 97 req/s | 82ms | 130ms | 30 | 4,365 |
| Sliding Window Counter | 92 req/s | 95ms | 161ms | 10 | 4,122 |
| Token Bucket | 102 req/s | 74ms | 135ms | 24 | 4,576 |
| Leaky Bucket | 98 req/s | 83ms | 149ms | 24 | 4,399 |

All four algorithms correctly rejected >99% of traffic once their limit was
exceeded, while keeping p95 latency under 165ms — confirming the Lua-script
atomic checks don't add meaningful overhead even under sustained concurrent load.

**Interesting finding during testing:** an early Token Bucket run showed a
p95 latency spike to 981ms (one run, not reproducible on retest). Correlating
with server logs pointed to a transient Redis reconnect mid-test — Upstash's
free tier drops idle connections periodically, and any requests in flight
during that reconnect window queue briefly rather than fail, thanks to
`enableOfflineQueue` being on and the NOSCRIPT-recovery logic in
`redisClient.js`. This is a good demonstration of why fail-open + automatic
reconnect handling matters: the system slowed briefly under a transient
failure but never went down or under/over-counted limits.

To reproduce any of these results:
```bash
npm start
k6 run k6-tests/loadtest.js -e ALGO=fixed          # or sliding / token-bucket / leaky-bucket
```

## Live Dashboard

**Try it live:** https://rate-limiter-eta.vercel.app/ (no setup needed)

A React + Recharts dashboard shows allowed vs rejected requests per algorithm
in real time, polling the backend's `/api/metrics` endpoint every second.

To run it locally instead:
```bash
# terminal 1: backend (from project root)
npm start

# terminal 2: dashboard
cd dashboard
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Generate some
traffic to see it update live:
```bash
k6 run k6-tests/loadtest.js -e ALGO=fixed
```

## Roadmap

- [x] Fixed Window Counter
- [x] Sliding Window Counter
- [x] Token Bucket
- [x] Leaky Bucket
- [ ] Sliding Window Log
- [x] k6 load test suite with p50/p95/p99 benchmarks
- [x] React + Recharts live dashboard (allowed vs blocked requests)
- [x] Deploy to Vercel + Render
