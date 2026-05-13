"use client";

import { useEffect, useState } from "react";
import { Zap, Clock, TrendingUp, Crown } from "lucide-react";
import { fetchUsage, type UsageSnapshot } from "@/lib/api/usage";
import { cn } from "@/lib/utils";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTimeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return "now";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function UsageBar({
  used,
  limit,
  label,
  icon: Icon,
  resetsAt,
  sublabel,
}: {
  used: number;
  limit: number;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  resetsAt: string;
  sublabel?: string;
}) {
  const pct = Math.min(100, (used / limit) * 100);
  const isHigh = pct >= 80;
  const isExhausted = pct >= 100;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              "h-4 w-4",
              isExhausted
                ? "text-destructive"
                : isHigh
                  ? "text-orange-500"
                  : "text-primary",
            )}
          />
          <span className="text-sm font-medium text-foreground">{label}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {sublabel}
        </span>
      </div>
      <div className="mb-2 h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            isExhausted
              ? "bg-destructive"
              : isHigh
                ? "bg-orange-500"
                : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {formatTokens(used)} / {formatTokens(limit)} response tokens
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Refreshes in {formatTimeUntil(resetsAt)}
        </span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchUsage()
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-foreground">
        Settings
      </h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Manage your plan and track your usage.
      </p>

      {/* Plan Card */}
      <div className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Crown className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {usage?.plan.label ?? "Free"} Plan
              </h2>
              <p className="text-sm text-muted-foreground">
                {usage
                  ? `${formatTokens(usage.plan.weeklyTokenLimit)} response tokens/week · ${formatTokens(usage.plan.windowTokenLimit)} per ${usage.plan.windowHours}h`
                  : "Loading plan details…"}
              </p>
            </div>
          </div>
          <button
            disabled
            className="rounded-lg bg-primary/10 px-4 py-2 text-sm font-medium text-primary opacity-50 cursor-not-allowed"
          >
            Upgrade
          </button>
        </div>
      </div>

      {/* Usage Section */}
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <TrendingUp className="h-4 w-4" />
        Response token usage
      </h2>

      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="ml-3 text-sm">Loading usage…</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load usage data: {error}
        </div>
      )}

      {usage && !loading && (
        <div className="space-y-4">
          <UsageBar
            used={usage.weekly.used}
            limit={usage.weekly.limit}
            label="Weekly Allowance"
            icon={Zap}
            resetsAt={usage.weekly.resetsAt}
            sublabel="Rolling 7-day window"
          />
          <UsageBar
            used={usage.window.used}
            limit={usage.window.limit}
            label={`${usage.window.windowHours}-Hour Window`}
            icon={Clock}
            resetsAt={usage.window.resetsAt}
            sublabel={`Rolling ${usage.window.windowHours}h window`}
          />
        </div>
      )}

      {/* Quota Explanation */}
      <div className="mt-8 rounded-xl border border-border bg-muted/30 p-5">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          How usage limits work
        </h3>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li>
            • We only count tokens in the tutor’s <strong>responses</strong> to
            you. The system instructions and your own messages don’t use up
            your quota.
          </li>
          <li>
            • <strong>Weekly allowance</strong> — total response tokens you can
            use in a rolling 7-day window. Oldest usage expires first.
          </li>
          <li>
            • <strong>Short window</strong> — prevents burst usage. Refreshes
            every {usage?.window.windowHours ?? 5} hours automatically.
          </li>
          <li>
            • Both limits must have remaining capacity to start a new chat
            message.
          </li>
        </ul>
      </div>
    </div>
  );
}
