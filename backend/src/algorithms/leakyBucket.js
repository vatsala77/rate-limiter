import redis, { evalWithReload } from "../redisClient.js";

/**
 * LEAKY BUCKET
 * -------------
 * How it works (mental model: a bucket with a small hole in the bottom):
 *  - Requests are like water poured into the bucket.
 *  - Water "leaks out" (gets processed) at a constant, fixed rate,
 *    no matter how fast it was poured in.
 *  - If the bucket overflows (water level > capacity), new requests
 *    are rejected.
 *
 * This is the OPPOSITE philosophy from Token Bucket:
 *  - Token Bucket: allows bursts, as long as the long-term average
 *    rate is respected. Good for bursty client traffic (dashboards,
 *    page loads).
 *  - Leaky Bucket: enforces a perfectly smooth, constant output rate.
 *    No bursts allowed, ever. Good for protecting a downstream system
 *    that can only handle a fixed throughput no matter what (e.g. a
 *    third-party API with a strict fixed rate limit of its own, or a
 *    payment gateway call you're relaying).
 *
 * Implementation approach (counter-based, not a real queue):
 *  - We don't literally queue and delay requests here — that would need
 *    a job queue (BullMQ, etc). Instead we track a virtual "water level"
 *    that decreases (leaks) over time at `leakRate` per second, and
 *    increases by 1 per incoming request. If level > capacity at request
 *    time, reject. This is the same lazy-computation trick as Token
 *    Bucket, just inverted (level goes down over time, not up).
 *
 * Why Lua script:
 *  - Same reasoning as Token Bucket: read current level + last leak
 *    time -> compute new level -> allow/reject -> write. Must be atomic
 *    or concurrent requests race on the same water level.
 */

const LEAKY_BUCKET_SCRIPT = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local leakRate = tonumber(ARGV[2])   -- units leaked (processed) per second
  local now = tonumber(ARGV[3])

  local bucket = redis.call("HMGET", key, "level", "lastLeak")
  local level = tonumber(bucket[1])
  local lastLeak = tonumber(bucket[2])

  if level == nil then
    level = 0
    lastLeak = now
  end

  -- drain the bucket based on time passed since we last checked
  local elapsed = math.max(0, now - lastLeak)
  local leaked = elapsed * leakRate
  level = math.max(0, level - leaked)

  local allowed = 0
  if level + 1 <= capacity then
    level = level + 1
    allowed = 1
  end

  redis.call("HMSET", key, "level", level, "lastLeak", now)
  redis.call("EXPIRE", key, math.ceil(capacity / leakRate) * 2)

  return {allowed, level}
`;

let scriptCache = { sha: null };

/**
 * @param {string} identifier
 * @param {object} opts - { capacity: max bucket size, leakRate: units/sec processed }
 */
export async function leakyBucketCheck(identifier, { capacity, leakRate }) {
  const key = `rl:leaky:${identifier}`;
  const now = Date.now() / 1000;

  const [allowed, level] = await evalWithReload(
    LEAKY_BUCKET_SCRIPT,
    scriptCache,
    1,
    key,
    capacity,
    leakRate,
    now
  );

  return {
    allowed: allowed === 1,
    limit: capacity,
    remaining: Math.floor(capacity - level),
    algorithm: "leaky-bucket",
  };
}