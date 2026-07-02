import redis from "../redisClient.js";

/**
 * SLIDING WINDOW COUNTER
 * ------------------------
 * How it works (fixes the boundary-burst problem of Fixed Window):
 *  - Still uses fixed-size buckets under the hood (cheap, like Fixed Window)
 *  - BUT instead of only looking at the current bucket, it also looks at
 *    the PREVIOUS bucket and takes a weighted count based on how far
 *    we are into the current window.
 *
 * Formula:
 *   estimated_count = previous_window_count * (1 - elapsed_fraction) + current_window_count
 *
 *   elapsed_fraction = how much of the current window has passed (0 to 1)
 *
 * Example: limit=100/min, previous window had 80 requests, we're 25%
 * into the current window with 20 requests so far:
 *   estimated = 80 * (1 - 0.25) + 20 = 60 + 20 = 80  -> still allowed
 *
 * This smooths out the edge-of-window burst because it partially "counts"
 * requests from the tail end of the previous window against the new one.
 *
 * Tradeoff vs Sliding Window Log:
 *  - Not perfectly precise (it's an approximation assuming even request
 *    distribution within the previous window) but O(1) memory per key
 *    instead of storing every single timestamp. This is what most real
 *    production rate limiters (e.g. Cloudflare) actually use.
 */

const SLIDING_WINDOW_SCRIPT = `
  local currKey = KEYS[1]
  local prevKey = KEYS[2]
  local limit = tonumber(ARGV[1])
  local windowSeconds = tonumber(ARGV[2])
  local elapsedFraction = tonumber(ARGV[3])

  local current = redis.call("INCR", currKey)
  if current == 1 then
    redis.call("EXPIRE", currKey, windowSeconds * 2)
  end

  local previous = tonumber(redis.call("GET", prevKey) or "0")

  local estimated = (previous * (1 - elapsedFraction)) + current

  if estimated > limit then
    return {0, current, estimated}
  else
    return {1, current, estimated}
  end
`;

let scriptSha = null;

async function loadScript() {
  if (!scriptSha) {
    scriptSha = await redis.script("LOAD", SLIDING_WINDOW_SCRIPT);
  }
  return scriptSha;
}

export async function slidingWindowCheck(identifier, { limit, windowSeconds }) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const currentWindowId = Math.floor(now / windowMs);
  const previousWindowId = currentWindowId - 1;
  const elapsedFraction = (now % windowMs) / windowMs;

  const currKey = `rl:sliding:${identifier}:${currentWindowId}`;
  const prevKey = `rl:sliding:${identifier}:${previousWindowId}`;

  const sha = await loadScript();

  const [allowed, current, estimated] = await redis.evalsha(
    sha,
    2,
    currKey,
    prevKey,
    limit,
    windowSeconds,
    elapsedFraction
  );

  return {
    allowed: allowed === 1,
    limit,
    remaining: Math.max(0, Math.floor(limit - estimated)),
    estimatedCount: Math.round(estimated * 100) / 100,
    algorithm: "sliding-window-counter",
  };
}