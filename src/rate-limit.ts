/**
 * Per-wallet token bucket rate limiter.
 *
 * In-memory map keyed by wallet address. We use distinct caps for
 * reads (cheap, high cap) and actions (expensive / mutating, low cap).
 *
 * Limits are per-process. For multi-replica deploys with shared
 * limits, swap for a Redis-backed bucket (interface stays the same).
 * Today we run a single replica on the LLM VPS — in-memory is right.
 *
 * Memory: each tracked wallet uses ~120 bytes (two number buckets +
 * timestamps). 10k active wallets = ~1.2 MB. Stale buckets are
 * garbage-collected via the `reaper` once every minute (anything not
 * touched in 5 minutes drops out).
 */

import { config } from "./config.js";

type Kind = "read" | "action";

type Bucket = {
  tokens: number;
  lastRefill: number;
};

type WalletBuckets = {
  read: Bucket;
  action: Bucket;
  lastSeen: number;
};

const buckets = new Map<string, WalletBuckets>();

function refill(bucket: Bucket, perMin: number, now: number): void {
  const elapsedMs = now - bucket.lastRefill;
  if (elapsedMs <= 0) return;
  const replenished = (elapsedMs / 60_000) * perMin;
  bucket.tokens = Math.min(perMin, bucket.tokens + replenished);
  bucket.lastRefill = now;
}

function init(wallet: string, now: number): WalletBuckets {
  const wb: WalletBuckets = {
    read: { tokens: config.RATE_LIMIT_READ_PER_MIN, lastRefill: now },
    action: { tokens: config.RATE_LIMIT_ACTION_PER_MIN, lastRefill: now },
    lastSeen: now,
  };
  buckets.set(wallet, wb);
  return wb;
}

/** Returns true if the request is allowed and decrements the bucket. */
export function check(wallet: string, kind: Kind): boolean {
  const now = Date.now();
  const wb = buckets.get(wallet) ?? init(wallet, now);
  wb.lastSeen = now;
  const bucket = wb[kind];
  const cap =
    kind === "read"
      ? config.RATE_LIMIT_READ_PER_MIN
      : config.RATE_LIMIT_ACTION_PER_MIN;
  refill(bucket, cap, now);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Inspect remaining tokens for a wallet (for diagnostics + tests). */
export function snapshot(wallet: string): {
  read: number;
  action: number;
} | null {
  const wb = buckets.get(wallet);
  if (!wb) return null;
  return {
    read: Math.floor(wb.read.tokens),
    action: Math.floor(wb.action.tokens),
  };
}

/** Test helper — wipe state between tests. */
export function reset(): void {
  buckets.clear();
}

/** Periodic GC of inactive wallets. */
const REAP_INTERVAL_MS = 60_000;
const STALE_MS = 5 * 60_000;
let reaper: ReturnType<typeof setInterval> | null = null;

export function startReaper(): void {
  if (reaper) return;
  reaper = setInterval(() => {
    const cutoff = Date.now() - STALE_MS;
    for (const [wallet, wb] of buckets) {
      if (wb.lastSeen < cutoff) buckets.delete(wallet);
    }
  }, REAP_INTERVAL_MS);
  // Don't keep the event loop alive just for the reaper.
  reaper.unref?.();
}

export function stopReaper(): void {
  if (reaper) {
    clearInterval(reaper);
    reaper = null;
  }
}
