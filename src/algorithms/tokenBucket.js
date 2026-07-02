import redis, { evalWithReload } from "../redisClient.js";

/**
 * TOKEN BUCKET
 * -------------
 * How it works:
 *  - Each identifier gets a "bucket" that holds up to `capacity` tokens.
 *  - Tokens refill continuously at `refillRate` tokens per second.
 *  - Every request tries to remove 1 token. If a token is available,
 *    request is allowed. If bucket is empty, request is rejected.
 *  - Because tokens accumulate while idle (up to `capacity`), a client
 *    that hasn't made requests in a while can "burst" — send many
 *    requests at once, up to the bucket's capacity, before being
 *    throttled to the steady refill rate.
 *
 * This is the algorithm real payment/API companies use (Stripe, AWS
 * API Gateway) because it allows natural bursty traffic (a client
 * loading a dashboard that fires 10 requests at once) while still
 * enforcing a long-term average rate.
 *
 * Why we don't run a background timer to add tokens:
 *  - Instead of ticking a clock server-side, we calculate tokens
 *    LAZILY: every time a request comes in, we compute how much time
 *    has passed since the last check, and how many tokens should have
 *    refilled in that time. This avoids needing a scheduled job and
 *    keeps everything in one atomic Lua call.
 *
 * Why Lua script here specifically matters:
 *  - The logic is: read current tokens + last refill time -> compute
 *    new token count -> decide allow/reject -> write new state.
 *    That's a read-modify-write sequence. Without atomicity, two
 *    concurrent requests could both read "1 token left", both decide
 *    "allowed", and the bucket goes negative — a classic double-spend
 *    race condition on the same resource.
 */

const TOKEN_BUCKET_SCRIPT = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refillRate = tonumber(ARGV[2])   -- tokens added per second
  local now = tonumber(ARGV[3])          -- current time in seconds (float)
  local requested = 1                    -- tokens this request consumes

  local bucket = redis.call("HMGET", key, "tokens", "lastRefill")
  local tokens = tonumber(bucket[1])
  local lastRefill = tonumber(bucket[2])

  if tokens == nil then
    -- first time we've seen this identifier: start with a full bucket
    tokens = capacity
    lastRefill = now
  end

  -- how many tokens should have regenerated since the last check
  local elapsed = math.max(0, now - lastRefill)
  local refilled = math.min(capacity, tokens + (elapsed * refillRate))

  local allowed = 0
  if refilled >= requested then
    refilled = refilled - requested
    allowed = 1
  end

  redis.call("HMSET", key, "tokens", refilled, "lastRefill", now)
  redis.call("EXPIRE", key, math.ceil(capacity / refillRate) * 2)

  return {allowed, refilled}
`;

let scriptCache = { sha: null };

/**
 * @param {string} identifier
 * @param {object} opts - { capacity: max burst size, refillRate: tokens/sec }
 */
export async function tokenBucketCheck(identifier, { capacity, refillRate }) {
  const key = `rl:token:${identifier}`;
  const now = Date.now() / 1000; // seconds, as a float for sub-second precision

  const [allowed, remaining] = await evalWithReload(
    TOKEN_BUCKET_SCRIPT,
    scriptCache,
    1,
    key,
    capacity,
    refillRate,
    now
  );

  return {
    allowed: allowed === 1,
    limit: capacity,
    remaining: Math.floor(remaining),
    algorithm: "token-bucket",
  };
}