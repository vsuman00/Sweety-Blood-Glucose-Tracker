import { createRedisClient as createClient } from "./redis.js";
import type { Redis } from "@upstash/redis";

export function createRedisClient(
  env?: Record<string, string | undefined>,
): Redis {
  return createClient(env);
}
