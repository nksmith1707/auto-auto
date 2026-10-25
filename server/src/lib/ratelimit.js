// Fixed-window rate limiter kept in memory. Good for one server; move to the database or Redis when we run several.
export function createLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return {
    // Returns seconds to wait if over the limit, otherwise 0.
    hit(key) {
      const t = now();
      let e = hits.get(key);
      if (!e || t >= e.reset) { e = { count: 0, reset: t + windowMs }; hits.set(key, e); }
      e.count++;
      if (hits.size > 50_000) for (const [k, v] of hits) if (t >= v.reset) hits.delete(k);
      return e.count > limit ? Math.ceil((e.reset - t) / 1000) : 0;
    },
    reset(key) { hits.delete(key); },
  };
}
