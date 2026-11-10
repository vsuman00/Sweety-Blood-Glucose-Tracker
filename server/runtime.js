export function runtimeOrigin(env = process.env) {
  if (env.APP_ORIGIN) return env.APP_ORIGIN;
  if (env.VERCEL_ENV === "preview") {
    const hostname = env.VERCEL_URL;
    if (
      typeof hostname !== "string" ||
      !/^[a-z0-9-]+\.vercel\.app$/.test(hostname)
    )
      throw new Error("Preview deployment requires a valid VERCEL_URL.");
    return `https://${hostname}`;
  }
  if (env.NODE_ENV === "production")
    throw new Error("Set APP_ORIGIN for production.");
  return "http://127.0.0.1:5173";
}
