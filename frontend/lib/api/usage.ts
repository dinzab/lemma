/**
 * Usage API Client
 *
 * Fetches the authenticated user's current token usage and plan details
 * via the Next.js API proxy.
 */

export interface PlanInfo {
  id: string;
  label: string;
  weeklyTokenLimit: number;
  windowTokenLimit: number;
  windowHours: number;
}

export interface UsageBucket {
  used: number;
  limit: number;
  resetsAt: string;
}

export interface WindowBucket extends UsageBucket {
  windowHours: number;
}

export interface UsageSnapshot {
  plan: PlanInfo;
  weekly: UsageBucket;
  window: WindowBucket;
}

/**
 * Fetch the current user's usage snapshot.
 */
export async function fetchUsage(): Promise<UsageSnapshot> {
  const response = await fetch('/api/usage');

  if (!response.ok) {
    throw new Error(`Failed to fetch usage: ${response.status}`);
  }

  return response.json();
}
