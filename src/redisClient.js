import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

// Single shared Redis connection for the whole app.
// In production behind multiple server instances, this is what makes
// the rate limiter "distributed" — every instance checks the same counters.
const redis = new Redis(process.env.UPSTASH_REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false, // don't queue commands if Redis is down — fail fast instead
});

redis.on("connect", () => console.log("[redis] connected"));
redis.on("error", (err) => console.error("[redis] error:", err.message));

export default redis;