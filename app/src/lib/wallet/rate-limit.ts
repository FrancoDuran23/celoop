// Sponsored operations per Safe. Server only.
//
// In memory per server instance: good enough to stop a runaway client, not a hard guarantee on
// serverless (each instance keeps its own count). The Pimlico sponsorship policy should carry the
// same per-sender limit as the hard stop; a `bundler_usage` table would make this one durable.
import { DAILY_OPERATIONS_PER_SAFE } from "./constants";

export type RateLimiter = {
  /** Counts one use for `key`. Returns false (and counts nothing) when the limit is reached. */
  take(key: string, now?: number): boolean;
  remaining(key: string, now?: number): number;
};

export function createMemoryRateLimiter(limit = DAILY_OPERATIONS_PER_SAFE, windowMs = 24 * 60 * 60 * 1000): RateLimiter {
  const uses = new Map<string, number[]>();
  const recent = (key: string, now: number) => {
    const kept = (uses.get(key) ?? []).filter((t) => now - t < windowMs);
    uses.set(key, kept);
    return kept;
  };
  return {
    take(key, now = Date.now()) {
      const k = key.toLowerCase();
      const list = recent(k, now);
      if (list.length >= limit) return false;
      list.push(now);
      return true;
    },
    remaining(key, now = Date.now()) {
      return Math.max(0, limit - recent(key.toLowerCase(), now).length);
    },
  };
}
