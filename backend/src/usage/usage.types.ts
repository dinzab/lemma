/**
 * Plan definition matching `public.plans` rows.
 */
export interface PlanRecord {
  id: string;
  label: string;
  weeklyTokenLimit: number;
  windowTokenLimit: number;
  windowHours: number;
}

/**
 * Snapshot of a user's current usage against their plan limits.
 * Returned by `GET /usage` so the frontend can render bars + countdowns.
 */
export interface UsageSnapshot {
  plan: PlanRecord;
  weekly: {
    used: number;
    limit: number;
    resetsAt: string; // ISO timestamp — 7 days from the oldest event in the window
  };
  window: {
    used: number;
    limit: number;
    windowHours: number;
    resetsAt: string; // ISO timestamp — windowHours from the oldest event in the window
  };
}

/**
 * Result of a pre-flight quota check. When `allowed` is false the
 * caller should return HTTP 429 with the rest of the fields.
 */
export interface QuotaCheckResult {
  allowed: boolean;
  /** Which bucket was exhausted — only set when `allowed === false`. */
  bucket?: 'weekly' | 'window';
  /** When the exhausted bucket will next have capacity. */
  resetAt?: string;
  /** Tokens remaining in the *tighter* bucket. */
  remaining: number;
}
