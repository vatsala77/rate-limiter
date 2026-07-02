import redis, { evalWithReload } from "../redisClient.js";

/**
 * FIXED WINDOW COUNTER
 * ---------------------
 * How it works:
 *  - Time is chopped into fixed-size blocks (e.g. every 60s: 12:00:00-12:01:00, 12:01:00-12:02:00...)
 *  - Each block has its own counter key in Redis.
 *  - Every request increments the counter for the CURRENT block.
 *  - If counter > limit, request is rejected.
 *
 * Why Lua script (not plain INCR + separate EXPIRE call)?
 *  - Without Lua: INCR happens, THEN we set expiry in a second command.
 *    If the process crashes/delays between those two commands, the key
 *    never expires -> memory leak, and counters never reset. Two round
 *    trips also means two separate network calls per request.
 *  - With Lua: INCR + conditional EXPIRE happen as ONE atomic operation
 *    on the Redis server itself. No race condition, one round trip.
 *
 * Known weakness (be ready to explain this in interviews):
 *  - Boundary burst problem. If limit = 100/min, a user could send
 *    100 requests at 11:59:59 and another 100 at 12:00:01 — that's
 *    200 requests in 2 real seconds, but each falls in a "clean" window.
 *    Sliding Window Counter (next file) fixes this.
 */

const FIXED_WINDOW_SCRIPT = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local windowSeconds = tonumber(ARGV[2])

  local current = redis.call("INCR", key)

  if current == 1 then
    -- first request in this window: set the key to expire
    -- exactly when the window ends, so it self-cleans from Redis
    redis.call("EXPIRE", key, windowSeconds)
  end

  local ttl = redis.call("TTL", key)

  if current > limit then
    return {0, current, ttl}  -- 0 = rejected
  else
    return {1, current, ttl}  -- 1 = allowed
  end
`;

let scriptCache = { sha: null };

/**
 * @param {string} identifier - e.g. userId, IP, or apiKey
 * @param {object} opts - { limit: number, windowSeconds: number }
 */
export async function fixedWindowCheck(identifier, { limit, windowSeconds }) {
  const key = `rl:fixed:${identifier}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;

  const [allowed, current, ttl] = await evalWithReload(
    FIXED_WINDOW_SCRIPT,
    scriptCache,
    1, // number of KEYS
    key,
    limit,
    windowSeconds
  );

  return {
    allowed: allowed === 1,
    limit,
    remaining: Math.max(0, limit - current),
    resetInSeconds: ttl,
    algorithm: "fixed-window",
  };
}