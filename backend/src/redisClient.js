import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

// Single shared Redis connection for the whole app.
// In production behind multiple server instances, this is what makes
// the rate limiter "distributed" — every instance checks the same counters.
//
// NOTE on Upstash specifically: their free tier closes idle TCP connections
// after a short period of inactivity. ioredis auto-reconnects when this
// happens, but if enableOfflineQueue is false, any command that arrives
// during that brief reconnect window fails immediately instead of waiting.
// So we let it queue (default: true) and give reconnects a real retry policy.
const redis = new Redis(process.env.UPSTASH_REDIS_URL, {
  maxRetriesPerRequest: 5,
  retryStrategy(times) {
    // exponential backoff, capped at 2s, so a dropped idle connection
    // reconnects quickly instead of hammering Upstash
    return Math.min(times * 200, 2000);
  },
  reconnectOnError() {
    // reconnect automatically on any connection-reset style error
    return true;
  },
});

redis.on("connect", () => console.log("[redis] connected"));
redis.on("error", (err) => console.error("[redis] error:", err.message));

/**
 * Runs a Lua script via EVALSHA, with automatic recovery if Redis has
 * forgotten the script (NOSCRIPT error).
 *
 * WHY THIS IS NEEDED:
 * We cache each script's SHA the first time it's loaded, so future calls
 * are cheap (EVALSHA sends just a hash, not the whole script). But if the
 * Redis connection drops and reconnects — which happens routinely on
 * Upstash's free tier when a connection sits idle — the server-side
 * script cache is wiped. Our old cached SHA then points at nothing, and
 * EVALSHA fails with "NOSCRIPT No matching script".
 *
 * Without handling this, that error gets caught by the middleware's
 * fail-open logic and the request silently passes through with NO rate
 * limiting applied and no indication anything went wrong — which is
 * exactly the bug we just saw (missing X-RateLimit headers, limits
 * never triggering). This helper detects that specific failure and
 * reloads the script once before giving up.
 *
 * @param {string} scriptText - the raw Lua script
 * @param {{sha: string|null}} cache - a mutable object holding the cached SHA
 * @param {number} numKeys - number of Redis KEYS the script expects
 * @param {...any} args - KEYS followed by ARGV values
 */
export async function evalWithReload(scriptText, cache, numKeys, ...args) {
  if (!cache.sha) {
    cache.sha = await redis.script("LOAD", scriptText);
  }

  try {
    return await redis.evalsha(cache.sha, numKeys, ...args);
  } catch (err) {
    if (err.message && err.message.includes("NOSCRIPT")) {
      // Script cache was wiped (likely a reconnect) — reload and retry once
      cache.sha = await redis.script("LOAD", scriptText);
      return await redis.evalsha(cache.sha, numKeys, ...args);
    }
    throw err; // any other error should still surface normally
  }
}

export default redis;