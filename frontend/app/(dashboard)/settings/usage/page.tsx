"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetchUsage, type UsageSnapshot } from "@/lib/api/usage";
import { cn } from "@/lib/utils";

/**
 * Usage & Limits page.
 *
 * Visual layout mirrors Devin's Settings → Usage & Limits screen so
 * the experience is familiar — *Current plan* card with primary
 * actions, a two-column "Your included usage" + "On-demand usage"
 * block, and a "Message usage limit" card below.
 *
 * Lemma's actual data model is only the weekly rolling quota + the
 * short-window (~5h) cap from `fetchUsage()`. The two cards on the
 * right ("On-demand usage", "Message usage limit") are visually
 * faithful **mocks** — Lemma has no prepaid balance system today —
 * so the buttons are non-functional and clearly disabled, but the
 * surface area is ready to wire up when paid plans land.
 *
 * Per the user's spec we display **percentage used only** (no raw
 * token counts) since the underlying number isn't actionable for
 * the student.
 */
export default function UsageAndLimitsPage() {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perMessageCap, setPerMessageCap] = useState<string>("10");

  useEffect(() => {
    let cancelled = false;
    fetchUsage()
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="no-scrollbar mx-auto h-full w-full max-w-4xl overflow-y-auto px-4 py-6 sm:px-6 sm:py-10">
        <Link
          href="/settings"
          className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          Settings
        </Link>

        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Usage &amp; Limits
        </h1>

        <Tabs defaultValue="overview" className="mt-4 sm:mt-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="history">Usage History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-5 space-y-4">
            <CurrentPlanCard usage={usage} loading={loading} />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <IncludedUsageCard
                usage={usage}
                loading={loading}
                error={error}
              />
              <OnDemandUsageCard />
            </div>

            <MessageUsageLimitCard
              value={perMessageCap}
              onChange={setPerMessageCap}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-5">
            <UsageHistoryEmpty />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

// ---- Current plan card -------------------------------------------------

function CurrentPlanCard({
  usage,
  loading,
}: {
  usage: UsageSnapshot | null;
  loading: boolean;
}) {
  const planLabel = usage?.plan.label ?? "Free";
  const isFreeTier = !usage || usage.plan.id === "free";

  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <span className="inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Current plan
      </span>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {loading ? <SkeletonText className="h-7 w-24" /> : planLabel}
      </h2>
      <p className="mt-1 text-sm text-primary">
        {loading
          ? null
          : isFreeTier
            ? "Free tier — upgrade to unlock more capacity"
            : "Active subscription"}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <MockButton tone="primary">Purchase on-demand usage</MockButton>
        <MockButton tone="ghost">Configure auto-reload settings</MockButton>
        <MockButton tone="ghost">Manage billing</MockButton>
      </div>
    </section>
  );
}

// ---- Your included usage card -----------------------------------------

function IncludedUsageCard({
  usage,
  loading,
  error,
}: {
  usage: UsageSnapshot | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <CardHeading
        title="Your included usage"
        tooltip="Quotas refresh automatically. Both must have remaining capacity to send a new message."
      />

      {loading ? (
        <div className="mt-4 space-y-5">
          <QuotaRowSkeleton />
          <QuotaRowSkeleton />
        </div>
      ) : error ? (
        <p className="mt-4 text-xs text-destructive">
          Failed to load usage data: {error}
        </p>
      ) : usage ? (
        <div className="mt-4 space-y-5">
          <QuotaRow
            label={`${usage.window.windowHours}-hour quota`}
            used={usage.window.used}
            limit={usage.window.limit}
            resetsAt={usage.window.resetsAt}
          />
          <QuotaRow
            label="Weekly quota"
            used={usage.weekly.used}
            limit={usage.weekly.limit}
            resetsAt={usage.weekly.resetsAt}
          />
        </div>
      ) : null}
    </section>
  );
}

function QuotaRow({
  label,
  used,
  limit,
  resetsAt,
}: {
  label: string;
  used: number;
  limit: number;
  resetsAt: string;
}) {
  const safeLimit = Math.max(1, limit);
  const pct = Math.max(0, Math.min(100, Math.round((used / safeLimit) * 100)));

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{pct}% used</span>
      </div>
      <Progress value={pct} className="mt-2 h-2" />
      <p className="mt-1.5 text-xs text-muted-foreground">
        Resets in {formatTimeUntil(resetsAt)}
      </p>
    </div>
  );
}

function QuotaRowSkeleton() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <SkeletonText className="h-4 w-28" />
        <SkeletonText className="h-3 w-14" />
      </div>
      <SkeletonText className="mt-2 h-2 w-full" />
      <SkeletonText className="mt-1.5 h-3 w-32" />
    </div>
  );
}

// ---- On-demand usage card (mock) --------------------------------------

function OnDemandUsageCard() {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <CardHeading
        title="On-demand usage"
        tooltip="Pay-as-you-go credit used once your included quota runs out. Coming soon."
      />

      <div className="mt-4 flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">
          Remaining balance
        </span>
        <span className="font-mono text-base font-semibold text-foreground">
          $0.00
        </span>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        No on-demand balance remaining. Sessions will pause when your included
        quota is exceeded.
      </p>
    </section>
  );
}

// ---- Message usage limit card (mock) ----------------------------------

function MessageUsageLimitCard({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <CardHeading
        title="Message usage limit"
        tooltip="Maximum on-demand usage Lemma can spend on a single response. Coming soon."
      />
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Maximum on-demand usage that Lemma can use per message you send.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          >
            $
          </span>
          <Input
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-28 pl-6"
            aria-label="Per-message usage cap"
          />
        </div>
        <MockButton tone="ghost">Update message usage limit</MockButton>
      </div>
    </section>
  );
}

// ---- Usage history empty state ----------------------------------------

function UsageHistoryEmpty() {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">
        Usage history is coming soon
      </p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">
        We&apos;re working on a detailed breakdown of your weekly token spend
        per chat thread. For now, the Overview tab shows your current quota
        state.
      </p>
    </div>
  );
}

// ---- Shared primitives ------------------------------------------------

function CardHeading({
  title,
  tooltip,
}: {
  title: string;
  tooltip: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${title} — info`}
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function MockButton({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "primary" | "ghost";
}) {
  // These actions ride on paid-plan infrastructure that Lemma
  // doesn't have yet — they're visually faithful to the design but
  // intentionally disabled. The tooltip explains the state so a
  // confused student doesn't keep clicking.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>
          <Button
            type="button"
            disabled
            variant={tone === "primary" ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-8 text-xs font-medium",
              tone === "primary" && "bg-primary/90 text-primary-foreground",
            )}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Coming soon</TooltipContent>
    </Tooltip>
  );
}

function SkeletonText({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-md bg-muted/60", className)} />
  );
}

// ---- Helpers ----------------------------------------------------------

function formatTimeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return "moments";
  const totalMinutes = Math.floor(diff / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  if (days >= 1) return `${days} day${days > 1 ? "s" : ""}`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours >= 1) return `${hours} hour${hours > 1 ? "s" : ""}`;
  const minutes = totalMinutes % 60;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
