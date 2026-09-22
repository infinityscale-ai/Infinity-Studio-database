export type RateLimiter = { allow(key: string): boolean };

type Window = { start: number; count: number };

const MAX_TRACKED_KEYS = 10_000;

// Drops windows that have already elapsed so the map cannot grow without bound.
function prune(windows: Map<string, Window>, at: number, windowMs: number): void {
  for (const [key, window] of windows) {
    if (at - window.start >= windowMs) windows.delete(key);
  }
}

// Creates a fixed-window in-memory limiter of `limit` hits per `windowMs` per key.
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, Window>();
  return {
    // Records one hit for the key and reports whether it is still within the window's limit.
    allow(key) {
      const at = now();
      const window = windows.get(key);
      if (!window || at - window.start >= windowMs) {
        if (windows.size >= MAX_TRACKED_KEYS) prune(windows, at, windowMs);
        windows.set(key, { start: at, count: 1 });
        return true;
      }
      window.count += 1;
      return window.count <= limit;
    },
  };
}
