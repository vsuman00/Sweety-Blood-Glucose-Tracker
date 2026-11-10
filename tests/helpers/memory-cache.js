export function memoryCache(namespace = "sweety:test") {
  const cache = {
    namespace,
    entries: new Map(),
    gets: [],
    sets: [],
    now: 0,
    async get(key) {
      cache.gets.push(key);
      if (cache.failGet) throw new Error("Synthetic cache outage");
      const entry = cache.entries.get(key);
      return entry && entry.expires > cache.now
        ? structuredClone(entry.value)
        : null;
    },
    async set(key, value, ttl) {
      if (cache.failSet) throw new Error("Synthetic cache write failure");
      cache.sets.push(key);
      cache.entries.set(key, {
        value: structuredClone(value),
        expires: cache.now + ttl * 1000,
      });
    },
  };
  return cache;
}
