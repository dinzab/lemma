import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  PlanRecord,
  QuotaCheckResult,
  UsageSnapshot,
} from './usage.types';

/**
 * Default plan used when a user has no `user_plans` row yet.
 * Matches the seed in migration 004.
 */
const DEFAULT_PLAN: PlanRecord = {
  id: 'free',
  label: 'Free',
  weeklyTokenLimit: 100_000,
  windowTokenLimit: 20_000,
  windowHours: 5,
};

/**
 * UsageService — owns token-usage tracking and quota enforcement.
 *
 * Two rolling buckets gate every `POST /chat/stream` request:
 *   1. **Weekly** — sum of tokens in the last 7 days vs `weekly_token_limit`.
 *   2. **Window** — sum of tokens in the last N hours vs `window_token_limit`.
 *
 * A request is allowed only when BOTH buckets have remaining capacity.
 *
 * Token recording happens AFTER a successful agent run (the stream may
 * have already delivered value to the student), so the quota check is
 * a best-effort gate — a burst of concurrent requests from the same
 * user could slightly exceed the limit, but the next request will be
 * blocked once the events land. This is an acceptable trade-off vs.
 * holding a transactional lock across the entire LLM call.
 */
@Injectable()
export class UsageService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsageService.name);
  private readonly supabase: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    const supabaseUrl = this.config.getOrThrow<string>('SUPABASE_URL');
    const supabaseServiceKey = this.config.getOrThrow<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  /**
   * On boot, ensure the default 'free' plan exists in `public.plans`.
   * The migration seeds it, but this is a defensive fallback so a
   * fresh database without the migration still works.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const { error } = await this.supabase.from('plans').upsert(
        {
          id: DEFAULT_PLAN.id,
          label: DEFAULT_PLAN.label,
          weekly_token_limit: DEFAULT_PLAN.weeklyTokenLimit,
          window_token_limit: DEFAULT_PLAN.windowTokenLimit,
          window_hours: DEFAULT_PLAN.windowHours,
        },
        { onConflict: 'id' },
      );
      if (error) {
        this.logger.warn(
          `Failed to upsert default plan: ${error.message}. ` +
            'This usually means the plans table is missing — ' +
            'apply backend/supabase/migrations/004_create_usage_events.sql.',
        );
      }
    } catch (err) {
      this.logger.warn(
        `Usage bootstrap failed: ${String(err)}. ` +
          'Usage enforcement will fall back to defaults.',
      );
    }
  }

  // ── Plan resolution ─────────────────────────────────────────────────────

  /**
   * Resolve the plan for `userId`. Creates a `user_plans` row defaulting
   * to 'free' if none exists.
   */
  async getPlan(userId: string): Promise<PlanRecord> {
    // Try to read existing user_plan → plan join
    const { data: userPlan, error: upErr } = await this.supabase
      .from('user_plans')
      .select('plan_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (upErr) {
      this.logger.warn(
        `Failed to read user_plans for ${userId}: ${upErr.message}`,
      );
      return DEFAULT_PLAN;
    }

    const planId = userPlan?.plan_id ?? 'free';

    // If the user has no row yet, insert one
    if (!userPlan) {
      const { error: insertErr } = await this.supabase
        .from('user_plans')
        .insert({ user_id: userId, plan_id: 'free' });
      if (insertErr && insertErr.code !== '23505') {
        this.logger.warn(
          `Failed to insert default user_plan for ${userId}: ${insertErr.message}`,
        );
      }
    }

    // Fetch the plan record
    const { data: plan, error: planErr } = await this.supabase
      .from('plans')
      .select('id, label, weekly_token_limit, window_token_limit, window_hours')
      .eq('id', planId)
      .maybeSingle();

    if (planErr || !plan) {
      this.logger.warn(
        `Failed to read plan '${planId}': ${planErr?.message ?? 'not found'}`,
      );
      return DEFAULT_PLAN;
    }

    return {
      id: plan.id as string,
      label: plan.label as string,
      weeklyTokenLimit: plan.weekly_token_limit as number,
      windowTokenLimit: plan.window_token_limit as number,
      windowHours: plan.window_hours as number,
    };
  }

  // ── Usage queries ───────────────────────────────────────────────────────

  /**
   * Sum tokens consumed by `userId` since `since` (ISO string).
   */
  private async sumTokensSince(userId: string, since: string): Promise<number> {
    // Supabase JS doesn't expose SUM as a first-class aggregate via
    // `.select()` in the v2 client, so we use an RPC or fall back to
    // fetching rows and summing client-side. For now, fetch the rows
    // (usage_events are small & indexed). If this becomes a perf
    // concern we can add a Postgres function.
    const { data, error } = await this.supabase
      .from('usage_events')
      .select('tokens_used')
      .eq('user_id', userId)
      .gte('created_at', since);

    if (error) {
      this.logger.warn(
        `Failed to sum tokens for ${userId} since ${since}: ${error.message}`,
      );
      return 0;
    }

    return (data ?? []).reduce(
      (acc, row) => acc + ((row.tokens_used as number) ?? 0),
      0,
    );
  }

  /**
   * Find the `created_at` of the oldest usage event within a window.
   * Used to compute a "resets at" timestamp for the UI.
   */
  private async oldestEventSince(
    userId: string,
    since: string,
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('usage_events')
      .select('created_at')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data.created_at as string;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Pre-flight quota check. Returns whether the user is allowed to start
   * a new agent run. Called by `ChatController.stream()` before kicking
   * off the agent loop.
   */
  async checkQuota(userId: string): Promise<QuotaCheckResult> {
    const plan = await this.getPlan(userId);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const windowAgo = new Date(
      now.getTime() - plan.windowHours * 60 * 60 * 1000,
    );

    const [weeklyUsed, windowUsed] = await Promise.all([
      this.sumTokensSince(userId, weekAgo.toISOString()),
      this.sumTokensSince(userId, windowAgo.toISOString()),
    ]);

    const weeklyRemaining = Math.max(0, plan.weeklyTokenLimit - weeklyUsed);
    const windowRemaining = Math.max(0, plan.windowTokenLimit - windowUsed);
    const remaining = Math.min(weeklyRemaining, windowRemaining);

    if (windowRemaining <= 0) {
      const oldest = await this.oldestEventSince(
        userId,
        windowAgo.toISOString(),
      );
      const resetAt = oldest
        ? new Date(
            new Date(oldest).getTime() + plan.windowHours * 60 * 60 * 1000,
          ).toISOString()
        : new Date(
            now.getTime() + plan.windowHours * 60 * 60 * 1000,
          ).toISOString();

      return { allowed: false, bucket: 'window', resetAt, remaining: 0 };
    }

    if (weeklyRemaining <= 0) {
      const oldest = await this.oldestEventSince(userId, weekAgo.toISOString());
      const resetAt = oldest
        ? new Date(
            new Date(oldest).getTime() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString()
        : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

      return { allowed: false, bucket: 'weekly', resetAt, remaining: 0 };
    }

    return { allowed: true, remaining };
  }

  /**
   * Full usage snapshot for the settings / plan page.
   */
  async getUsageSnapshot(userId: string): Promise<UsageSnapshot> {
    const plan = await this.getPlan(userId);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const windowAgo = new Date(
      now.getTime() - plan.windowHours * 60 * 60 * 1000,
    );

    const [weeklyUsed, windowUsed, weeklyOldest, windowOldest] =
      await Promise.all([
        this.sumTokensSince(userId, weekAgo.toISOString()),
        this.sumTokensSince(userId, windowAgo.toISOString()),
        this.oldestEventSince(userId, weekAgo.toISOString()),
        this.oldestEventSince(userId, windowAgo.toISOString()),
      ]);

    const weeklyResetAt = weeklyOldest
      ? new Date(
          new Date(weeklyOldest).getTime() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString()
      : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const windowResetAt = windowOldest
      ? new Date(
          new Date(windowOldest).getTime() + plan.windowHours * 60 * 60 * 1000,
        ).toISOString()
      : new Date(
          now.getTime() + plan.windowHours * 60 * 60 * 1000,
        ).toISOString();

    return {
      plan,
      weekly: {
        used: weeklyUsed,
        limit: plan.weeklyTokenLimit,
        resetsAt: weeklyResetAt,
      },
      window: {
        used: windowUsed,
        limit: plan.windowTokenLimit,
        windowHours: plan.windowHours,
        resetsAt: windowResetAt,
      },
    };
  }

  /**
   * Record token consumption for a completed agent run. Called by
   * `ChatService` after the agent loop finishes successfully.
   */
  async recordUsage(opts: {
    userId: string;
    runId: string;
    threadId: string;
    tokensUsed: number;
  }): Promise<void> {
    if (opts.tokensUsed <= 0) return;

    const { error } = await this.supabase.from('usage_events').insert({
      user_id: opts.userId,
      run_id: opts.runId,
      thread_id: opts.threadId,
      tokens_used: opts.tokensUsed,
    });

    if (error) {
      this.logger.warn(
        `Failed to record usage for run ${opts.runId}: ${error.message}`,
      );
    }
  }
}
