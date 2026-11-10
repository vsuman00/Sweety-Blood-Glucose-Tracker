import { Redis } from "@upstash/redis";

/** @param {Record<string, string | undefined>} [env] */
export function createRedisClient(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token)
    throw new Error(
      "Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  let endpoint;
  try {
    endpoint = new URL(url);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/"
    )
      throw new Error();
  } catch {
    throw new Error("UPSTASH_REDIS_REST_URL must be an HTTPS origin.");
  }
  return new Redis({
    url: endpoint.origin,
    token,
    retry: { retries: 0 },
    signal: () => AbortSignal.timeout(1000),
    enableTelemetry: false,
    enableAutoPipelining: false,
  });
}
