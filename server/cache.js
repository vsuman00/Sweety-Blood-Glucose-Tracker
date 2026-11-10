import { createRedisClient } from "../lib/redis.js";

export function createCache(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL,
    token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url && !token) return null;
  const redis = createRedisClient(env);
  const namespace = env.CACHE_NAMESPACE;
  if (typeof namespace !== "string" || !/^[a-z0-9:_-]{1,100}$/.test(namespace))
    throw new Error(
      "Set a unique CACHE_NAMESPACE using lowercase letters, numbers, colons, underscores or hyphens.",
    );
  return {
    namespace,
    async get(key) {
      return redis.get(key);
    },
    async set(key, value, ttl = 60) {
      await redis.set(key, value, { ex: ttl });
    },
    async delete(key) {
      await redis.del(key);
    },
  };
}
