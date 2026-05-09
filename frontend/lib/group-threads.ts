import type { Thread } from "@/lib/api/threads";

/**
 * A grouping bucket for the sidebar's "Your chats" list.
 *
 * Group ids are stable strings used as React keys (`today`, `yesterday`,
 * `previous-7-days`, `previous-30-days`, or a year-month like `2025-04` for
 * older buckets). Labels are user-facing and locale-aware where applicable.
 */
export interface ThreadGroup {
  id: string;
  label: string;
  threads: Thread[];
}

const startOfDay = (date: Date): Date => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const daysBefore = (date: Date, days: number): Date => {
  const next = startOfDay(date);
  next.setDate(next.getDate() - days);
  return next;
};

const olderMonthLabel = (date: Date): string =>
  date.toLocaleString(undefined, { month: "long", year: "numeric" });

const olderMonthId = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

/**
 * Buckets a (server-paginated, newest-first) list of threads into recency
 * groups: Today / Yesterday / Previous 7 days / Previous 30 days / per-month
 * for older threads. Empty groups are dropped.
 *
 * Uses `updatedAt` if present and parsable, falling back to `createdAt`.
 *
 * @param threads - Threads ordered newest-first by the backend.
 * @param now - Override for "current time" (used by tests).
 */
export function groupThreadsByRecency(
  threads: Thread[],
  now: Date = new Date(),
): ThreadGroup[] {
  const todayStart = startOfDay(now);
  const yesterdayStart = daysBefore(now, 1);
  const sevenDaysStart = daysBefore(now, 7);
  const thirtyDaysStart = daysBefore(now, 30);

  const groupsById = new Map<string, ThreadGroup>();
  const order: string[] = [];

  const ensure = (id: string, label: string): ThreadGroup => {
    let group = groupsById.get(id);
    if (!group) {
      group = { id, label, threads: [] };
      groupsById.set(id, group);
      order.push(id);
    }
    return group;
  };

  for (const thread of threads) {
    const tsRaw = thread.updatedAt || thread.createdAt;
    const ts = new Date(tsRaw);
    if (Number.isNaN(ts.getTime())) {
      // Unparseable timestamps shouldn't happen but skip them rather than
      // throw — the sidebar should never crash because of one bad row.
      continue;
    }
    if (ts >= todayStart) {
      ensure("today", "Today").threads.push(thread);
    } else if (ts >= yesterdayStart) {
      ensure("yesterday", "Yesterday").threads.push(thread);
    } else if (ts >= sevenDaysStart) {
      ensure("previous-7-days", "Previous 7 days").threads.push(thread);
    } else if (ts >= thirtyDaysStart) {
      ensure("previous-30-days", "Previous 30 days").threads.push(thread);
    } else {
      ensure(olderMonthId(ts), olderMonthLabel(ts)).threads.push(thread);
    }
  }

  return order
    .map((id) => groupsById.get(id))
    .filter((g): g is ThreadGroup => g !== undefined && g.threads.length > 0);
}
