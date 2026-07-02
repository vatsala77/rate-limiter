import { fixedWindowCheck } from "./algorithms/fixedWindow.js";
import { slidingWindowCheck } from "./algorithms/slidingWindowCounter.js";
import { tokenBucketCheck } from "./algorithms/tokenBucket.js";
import { leakyBucketCheck } from "./algorithms/leakyBucket.js";

// Strategy pattern: add new algorithms here without touching the middleware logic.
const ALGORITHMS = {
  "fixed-window": fixedWindowCheck,
  "sliding-window": slidingWindowCheck,
  "token-bucket": tokenBucketCheck,
  "leaky-bucket": leakyBucketCheck,
};

/**
 * @param {object} config
 *   algorithm: "fixed-window" | "sliding-window" | "token-bucket" | "leaky-bucket"
 *   keyGenerator: (req) => string  -- how to identify the caller (IP, userId, apiKey...)
 *   failureMode: "fail-open" | "fail-closed" -- what to do if Redis is unreachable
 *
 *   -- for fixed-window / sliding-window:
 *   limit: max requests allowed per window
 *   windowSeconds: window size in seconds
 *
 *   -- for token-bucket / leaky-bucket:
 *   capacity: max bucket size (burst allowance)
 *   refillRate / leakRate: tokens or units processed per second
 */
export function rateLimiter({
  algorithm = "fixed-window",
  keyGenerator = (req) => req.ip,
  failureMode = process.env.FAILURE_MODE || "fail-open",
  ...params
} = {}) {
  const check = ALGORITHMS[algorithm];
  if (!check) {
    throw new Error(`Unknown rate limit algorithm: ${algorithm}`);
  }

  return async function middleware(req, res, next) {
    const identifier = keyGenerator(req);

    try {
      const result = await check(identifier, params);

      // Standard rate-limit headers, same convention as GitHub/Stripe APIs
      res.set("X-RateLimit-Limit", String(result.limit));
      res.set("X-RateLimit-Remaining", String(result.remaining));
      res.set("X-RateLimit-Algorithm", result.algorithm);

      if (!result.allowed) {
        return res.status(429).json({
          error: "Too Many Requests",
          algorithm: result.algorithm,
          retryAfterSeconds: result.resetInSeconds || params.windowSeconds || 1,
        });
      }

      return next();
    } catch (err) {
      console.error("[rate-limiter] Redis check failed:", err.message);

      if (failureMode === "fail-closed") {
        // Redis down -> block everything. Safer for abuse-sensitive APIs
        // (e.g. login endpoints), but hurts availability.
        return res.status(503).json({ error: "Rate limiter unavailable" });
      }

      // fail-open (default) -> let the request through. Prioritizes
      // uptime over strict limiting when the dependency is down.
      return next();
    }
  };
}