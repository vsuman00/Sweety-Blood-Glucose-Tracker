export async function cleanupLiveCache({ cache, keys, userId, pool, store }) {
  let failures = 0;
  const deleted = await Promise.allSettled(
    [...keys].map((key) => {
      if (!key.startsWith(`${cache.namespace}:`))
        return Promise.reject(new Error("Key outside test namespace."));
      return cache.delete(key);
    }),
  );
  failures += deleted.filter((result) => result.status === "rejected").length;
  try {
    if (userId)
      for (const query of [
        "DELETE FROM sessions WHERE sess->>'userId'=$1",
        "DELETE FROM users WHERE id=$1",
      ]) {
        try {
          await pool.query(query, [String(userId)]);
        } catch {
          failures++;
        }
      }
  } finally {
    try {
      store.close();
    } finally {
      await pool.end();
    }
  }
  if (failures)
    throw new Error(`Live cache cleanup failed for ${failures} resources.`);
}
