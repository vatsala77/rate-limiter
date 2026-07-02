
import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

console.log("Connecting to:", process.env.UPSTASH_REDIS_URL?.replace(/:[^:@]+@/, ":****@"));

const redis = new Redis(process.env.UPSTASH_REDIS_URL);

redis.on("connect", () => console.log("[connect event] fired"));
redis.on("ready", () => console.log("[ready event] fired — connection is usable"));
redis.on("error", (err) => console.log("[error event]:", err.message));
redis.on("close", () => console.log("[close event] connection closed"));
redis.on("reconnecting", (delay) => console.log("[reconnecting event] in", delay, "ms"));

async function runTest() {
  console.log("\n--- Running 5 sequential PING tests, 2s apart ---\n");
  for (let i = 1; i <= 5; i++) {
    const start = Date.now();
    try {
      const result = await redis.ping();
      console.log(`Test ${i}: PING -> ${result} (${Date.now() - start}ms)`);
    } catch (err) {
      console.log(`Test ${i}: FAILED -> ${err.message} (${Date.now() - start}ms)`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  process.exit(0);
}

runTest();