# Distributed Rate Limiter

A Redis-backed, multi-algorithm rate limiter built as reusable Express middleware. It is meant to demonstrate distributed-systems concepts (atomicity, race conditions, failure-mode trade-offs), not just a working demo.

## 🔗 Live Demo

**Dashboard:** https://rate-limiter-eta.vercel.app/
**API:** https://rate-limiter-l8yi.onrender.com/api/fixed

> The backend runs on Render's free tier, which sleeps after 15 minutes of inactivity. The first request after idle can take 30–50 seconds. Live dashboard metrics are in-memory, so they reset whenever the server restarts or wakes up.

## Why this exists

Most rate limiter tutorials use a single in-memory counter, which breaks as soon as you run more than one server instance. This project keeps the rate-limit state in Redis, so the limit is enforced across N instances of your API.

## Project structure

```
rate-limiter/
├── backend/
│   ├── src/
│   │   ├── server.js            # Express app, routes, CORS
│   │   ├── middleware.js        # rateLimiter() factory, strategy pattern, failure modes
│   │   ├── redisClient.js       # shared ioredis connection + evalWithReload (NOSCRIPT recovery)
│   │   ├── metrics.js           # in-memory counters for the dashboard
│   │   ├── diagnose.js          # dev-only script: Redis connection / PING latency check
│   │   ├── algorithms/          # fixedWindow, slidingWindowCounter, tokenBucket, leakyBucket
│   │   └── utils/firehoseLogger.js  # fire-and-forget request logs to AWS Kinesis Firehose
│   └── k6-tests/loadtest.js     # k6 load test
└── dashboard/                   # React + Recharts live dashboard (Vite)
```

## How to test this

You don't need to install anything. Everything below works against the live API.

**1. Open the dashboard:** https://rate-limiter-eta.vercel.app/ and keep it open.

**2. Send one request**

Mac/Linux:
```bash
curl -i https://rate-limiter-l8yi.onrender.com/api/fixed
```
Windows (PowerShell):
```powershell
curl.exe -i https://rate-limiter-l8yi.onrender.com/api/fixed
```

You should see something like:
```
HTTP/1.1 200 OK
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Algorithm: fixed-window
{"message":"success","algorithm":"fixed-window"}
```

**3. Trigger the limit** (10 requests per 30 seconds per client)

Mac/Linux:
```bash
for i in {1..12}; do curl -i https://rate-limiter-l8yi.onrender.com/api/fixed; echo; done
```
Windows (PowerShell):
```powershell
1..12 | ForEach-Object { curl.exe -i https://rate-limiter-l8yi.onrender.com/api/fixed }
```

The first 10 return `200 OK`; the rest return `429 Too Many Requests`.

**4. Try the other algorithms** by swapping the path:
```
/api/sliding
/api/token-bucket
/api/leaky-bucket
```

**5. See the raw numbers behind the dashboard**
```bash
curl https://rate-limiter-l8yi.onrender.com/api/metrics
```

**6. Read the code:** start with `backend/src/middleware.js`, then `backend/src/algorithms/`, then `backend/src/redisClient.js`.

## How to run locally

```bash
cd backend
npm install
cp .env.example .env
# fill in UPSTASH_REDIS_URL from https://console.upstash.com
npm start
```

```bash
curl http://localhost:3000/api/fixed
curl http://localhost:3000/api/sliding
```

AWS Firehose logging is optional. If `AWS_*` / `FIREHOSE_STREAM_NAME` are not set, log pushes fail with a non-fatal warning and requests are unaffected. Never commit `.env`.

## Algorithms implemented

| Algorithm | Memory | Accuracy | Bursts | Notes |
|---|---|---|---|---|
| Fixed Window | O(1) per key | Low | Up to 2x the limit across a window boundary | Simplest and cheapest |
| Sliding Window Counter | O(1) per key (2 counters) | High (weighted approximation) | No boundary burst | Rejected requests are also counted (see below) |
| Token Bucket | O(1) per key | High | Yes, intentionally, up to `capacity` | Used by Stripe, AWS API Gateway |
| Leaky Bucket (meter) | O(1) per key | High | An idle client can still send up to `capacity` at once | Counter-based, not a real queue |

**About the Leaky Bucket here:** this is the "leaky bucket as a meter" variant. It tracks a virtual water level that drains over time. It does not queue or delay requests, so it does not shape output to a perfectly constant rate. In this form it behaves mathematically like a token bucket (`level = capacity − tokens`), which is why both show the same allowed counts in the benchmark. A true shaping version needs a job queue (e.g. BullMQ), which is out of scope.

## Design decisions worth asking me about in an interview

**1. Why Lua scripts instead of plain Redis commands?**
Token Bucket, Leaky Bucket and Sliding Window all do a read, compute, write sequence. With separate `HMGET` / `HMSET` calls, two concurrent requests can both read "1 token left", both decide "allowed", and the limit is exceeded. Wrapping the whole sequence in one Lua script (`EVALSHA`) makes Redis execute it atomically, in one network round trip. For Fixed Window, `INCR` is already atomic, so Lua is used there mainly to make `INCR` + `EXPIRE` + `TTL` a single unit and to keep every algorithm on the same pattern.

**2. NOSCRIPT recovery**
Scripts are cached by SHA. If Redis loses its script cache (server restart or failover on a managed service), `EVALSHA` fails with `NOSCRIPT`. Without handling, the middleware's fail-open path swallowed that error and requests silently passed with no limiting. `evalWithReload` detects `NOSCRIPT`, reloads the script and retries once.

**3. Fail-open vs fail-closed**
If Redis is unreachable:
- `fail-open` (default): let the request through. Prioritizes uptime.
- `fail-closed`: respond `503`. Better for abuse-sensitive endpoints like login or payments.

Configurable via `FAILURE_MODE` or per route. During a short reconnect, ioredis queues commands (offline queue) with a bounded retry policy (about 3 seconds of backoff in total) before they fail and the failure mode applies.

**4. The boundary-burst problem**
With a 30-second fixed window, a client can send the full quota at the end of one window and again at the start of the next: 2x the limit in a very short time. Sliding Window Counter blends in a weighted share of the previous window: `estimated = previous × (1 − elapsedFraction) + current`.

**5. Why metrics are not in Redis**
Metrics are for observability only, not for the rate-limit decision, so losing them on restart is acceptable. The trade-off: with several instances each one only sees its own counts (see Known limitations).

**6. Hot key problem (not solved here)**
A single very active identifier makes one Redis key a hotspot. At scale this is handled with two-tier limiting (approximate local limit, periodic sync to Redis).

## Architecture

```
Client request
      |
      v
Express middleware (backend/src/middleware.js)
      |  picks algorithm via strategy pattern
      |--------------------------> res.on("finish") -> Firehose log (fire-and-forget)
      v
Algorithm module (backend/src/algorithms/*.js)
      |  runs atomic Lua script (EVALSHA, NOSCRIPT recovery)
      v
Redis (Upstash): shared state across all server instances
```

## Benchmark results (k6 load test)

Setup: 45 s run, ramping 5 → 30 virtual users, one client identity (all virtual users share one key), limit/capacity of 10 per algorithm. Script: `backend/k6-tests/loadtest.js`.

> TODO before sharing: confirm the target these numbers were measured against and keep one of these lines.
> - Measured locally against `http://localhost:3000` (Upstash Redis).
> - Measured against the deployed Render API.

| Algorithm | Throughput | Avg latency | p95 latency | Allowed | Rejected |
|---|---|---|---|---|---|
| Fixed Window | 97 req/s | 82 ms | 130 ms | 30 | 4,365 |
| Sliding Window Counter | 92 req/s | 95 ms | 161 ms | 10 | 4,122 |
| Token Bucket | 102 req/s | 74 ms | 135 ms | 24 | 4,576 |
| Leaky Bucket | 98 req/s | 83 ms | 149 ms | 24 | 4,399 |

**Reading the numbers**
- **Fixed Window, 30 allowed:** the 45 s test spans about three 30 s windows, with up to 10 allowed in each.
- **Sliding Window, 10 allowed:** rejected requests also increment the counter, so a client that keeps hammering carries a large `previous` count into the next window and stays blocked until it goes quiet. This is a deliberate trade-off, and it is stricter than the other algorithms.
- **Token / Leaky Bucket, 24 allowed:** about 10 initial capacity plus 45 s × (1/3 per second) ≈ 25 possible; 24 were allowed.
- **Latency:** every algorithm rejected more than 99% of traffic once over the limit, with p95 under 165 ms. Most of this latency is the network round trip to Redis. There is no "without Lua" baseline, so these numbers do not isolate Lua overhead.

**Latency spike during testing:** one early Token Bucket run showed a p95 of 981 ms that did not reproduce. Server logs suggested a Redis reconnect mid-test (Upstash's free tier drops idle connections). In-flight commands waited in ioredis's offline queue instead of failing, and the NOSCRIPT recovery covers a lost script cache after a reconnect. This was observed once and is not a proven root cause.

Reproduce:
```bash
cd backend
npm start
k6 run k6-tests/loadtest.js -e ALGO=fixed -e BASE_URL=http://localhost:3000
# ALGO = fixed | sliding | token-bucket | leaky-bucket
```

## Live dashboard

A React + Recharts dashboard shows allowed vs rejected requests per algorithm, polling `/api/metrics` every second. Try it at https://rate-limiter-eta.vercel.app/

Run locally:
```bash
# terminal 1
cd backend && npm start

# terminal 2
cd dashboard
npm install
npm run dev
```

## Request logging (AWS Kinesis Firehose)

Every request outcome (IP, method, path, status code, algorithm, timestamp) is pushed to a Firehose delivery stream as newline-delimited JSON, ready for S3 and Athena. It is fire-and-forget: errors are caught and logged as warnings, and never affect the response.

## Known limitations

- **Metrics are per instance.** Rate limiting is distributed through Redis, but `/api/metrics` only reflects the instance that served the request.
- **Time comes from the app server** (`Date.now()`), not Redis. Instances with skewed clocks can compute slightly different windows or refill amounts. Reading `TIME` inside the Lua script would fix this.
- **`Retry-After` is approximate.** Bucket algorithms do not return an exact wait time yet, so the middleware falls back to a default.
- **Firehose logging does one API call per request.** At high traffic it should be batched (`PutRecordBatch`) with a bounded buffer, and client IPs should be hashed.
- **Behind a proxy (Render)** the real client IP needs `app.set("trust proxy", 1)`, otherwise clients may share one key.
- **Hot keys** are not mitigated (see above).
- **No concurrency proof test yet:** a test that fires N parallel requests at one key and asserts exactly `limit` are allowed.

## Roadmap

- [x] Fixed Window Counter
- [x] Sliding Window Counter
- [x] Token Bucket
- [x] Leaky Bucket (meter variant)
- [x] k6 load test suite
- [x] React + Recharts live dashboard
- [x] Deploy to Vercel + Render
- [x] Request logging to Kinesis Firehose
- [ ] Concurrency test (exactly N allowed under parallel load)
- [ ] Accurate `Retry-After` and `X-RateLimit-Reset` for all algorithms
- [ ] Redis `TIME` inside Lua to remove clock-skew risk
- [ ] Failure / fail-open counter on the dashboard
- [ ] Batched Firehose logging
- [ ] Sliding Window Log
- [ ] True leaky bucket with a queue
