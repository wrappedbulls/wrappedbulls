// Simple TTL-keyed in-memory cache. Lives in the Next.js server runtime.
// Used to cache rendered PNG/SVG bytes + chain reads so repeated hits don't
// re-render or re-RPC.
//
// Not LRU — Map of tier -> { entry, expiresAt }. Bounded by MAX_BULLS (1000)
// so the worst-case memory is ~25MB (1000 * ~25KB PNG). Evicts only on TTL.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const stores: Record<string, Map<string, CacheEntry<unknown>>> = {};

export function cacheGet<T>(store: string, key: string): T | undefined {
  const m = stores[store];
  if (!m) return undefined;
  const e = m.get(key);
  if (!e) return undefined;
  if (e.expiresAt < Date.now()) {
    m.delete(key);
    return undefined;
  }
  return e.value as T;
}

export function cacheSet<T>(store: string, key: string, value: T, ttlMs: number): void {
  if (!stores[store]) stores[store] = new Map();
  stores[store].set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function cacheWrap<T>(
  store: string,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(store, key);
  if (hit !== undefined) return hit;
  const value = await load();
  cacheSet(store, key, value, ttlMs);
  return value;
}

// In-flight promise map for single-flight (request coalescing). When N
// concurrent requests miss the cache for the same key, only ONE load()
// runs; the other N-1 await the same promise. Core defense against the
// marketplace-crawl thundering herd that 429s a single RPC key.
const inflight: Record<string, Map<string, Promise<unknown>>> = {};
// Last-known value retained past TTL so we can serve it instantly while a
// background refresh runs (stale-while-revalidate at the in-process layer
// — there is no CDN in front to do it for us).
const staleStores: Record<string, Map<string, unknown>> = {};

function singleFlight<T>(
  store: string,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  if (!inflight[store]) inflight[store] = new Map();
  const m = inflight[store];
  const running = m.get(key);
  if (running) return running as Promise<T>;
  const p = (async () => {
    try {
      const value = await load();
      cacheSet(store, key, value, ttlMs);
      if (!staleStores[store]) staleStores[store] = new Map();
      staleStores[store].set(key, value);
      return value;
    } finally {
      m.delete(key);
    }
  })();
  m.set(key, p);
  return p;
}

// Stale-while-revalidate + single-flight wrapper.
//   - Fresh hit (within ttl) → return immediately, zero RPC.
//   - Stale hit (past ttl)   → return stale value now AND kick a
//                              single-flighted background refresh.
//   - Cold miss              → single-flighted load (concurrent callers
//                              share one RPC round-trip).
// negativeTtlMs lets a "not wrapped" (null) result expire faster than a
// positive one so a freshly-wrapped tier surfaces quickly, while a wrapped
// bull (only changes on unwrap) is cached long and cheaply.
export async function cacheWrapSWR<T>(
  store: string,
  key: string,
  opts: { ttlMs: number; negativeTtlMs?: number },
  load: () => Promise<T>,
): Promise<T> {
  const m = stores[store];
  const e = m?.get(key);
  const now = Date.now();

  if (e && e.expiresAt >= now) return e.value as T; // fresh

  const staleVal = staleStores[store]?.get(key);
  if (staleVal !== undefined) {
    void singleFlight(store, key, opts.ttlMs, async () => {
      const v = await load();
      const ttl = v == null ? (opts.negativeTtlMs ?? opts.ttlMs) : opts.ttlMs;
      cacheSet(store, key, v, ttl);
      return v;
    }).catch(() => {/* keep serving stale if refresh fails */});
    return staleVal as T;
  }

  const value = await singleFlight(store, key, opts.ttlMs, load);
  const ttl = value == null ? (opts.negativeTtlMs ?? opts.ttlMs) : opts.ttlMs;
  cacheSet(store, key, value, ttl);
  return value;
}

// Diagnostic — returns counts per store. Useful for /health.
export function cacheStats(): Record<string, { size: number; sample?: string[] }> {
  const out: Record<string, { size: number; sample?: string[] }> = {};
  for (const [name, m] of Object.entries(stores)) {
    out[name] = { size: m.size };
    if (m.size > 0) {
      out[name].sample = Array.from(m.keys()).slice(0, 5);
    }
  }
  return out;
}
