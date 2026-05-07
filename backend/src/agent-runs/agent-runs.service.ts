import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  ActiveRunDto,
  AgentRunRecord,
  AgentRunStatus,
  rowToAgentRun,
} from './agent-run.types';

/**
 * AgentRunsService — owns the lifecycle of `public.agent_runs` rows.
 *
 * Each streaming chat turn produces exactly one row, transitioning:
 *   running → completed | failed | cancelled
 *
 * On boot we sweep any orphaned `running` rows (server restart mid-turn) and
 * mark them `failed` so the UI can show a "previous run failed, retry?"
 * affordance instead of a forever-spinning indicator.
 *
 * Mutations always use the Supabase service-role key (bypasses RLS) and
 * scope by `(thread_id, user_id)` defensively, matching the convention in
 * `ThreadsService`.
 */
@Injectable()
export class AgentRunsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AgentRunsService.name);
  private readonly supabase: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.getOrThrow<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  /**
   * Boot recovery: any `running` rows surviving a restart are by definition
   * orphaned (no in-process stream is producing their events). Mark them
   * `failed` so reconnects don't see ghost spinners.
   *
   * Failures here are logged but never throw — we don't want to prevent the
   * process from coming up just because the recovery sweep didn't run.
   */
  async onApplicationBootstrap(): Promise<void> {
    const { data, error } = await this.supabase
      .from('agent_runs')
      .update({
        status: 'failed' as AgentRunStatus,
        completed_at: new Date().toISOString(),
        error: 'Server restarted before run completed',
      })
      .eq('status', 'running')
      .select('id');

    if (error) {
      this.logger.warn(
        `Boot recovery sweep failed: ${error.message}. ` +
          'This usually means the agent_runs table is missing — ' +
          'apply backend/supabase/migrations/002_create_messages_and_runs.sql.',
      );
      return;
    }

    const recovered = data?.length ?? 0;
    if (recovered > 0) {
      this.logger.log(
        `Boot recovery: marked ${recovered} orphaned running run(s) as failed.`,
      );
    }
  }

  /**
   * Create a new run row in `running` status. Returns the generated id so
   * the caller can carry it through the streaming pipeline (every message
   * row written during the turn references this id).
   */
  async startRun(opts: {
    threadId: string;
    userId: string;
  }): Promise<AgentRunRecord> {
    const { data, error } = await this.supabase
      .from('agent_runs')
      .insert({
        thread_id: opts.threadId,
        user_id: opts.userId,
        status: 'running' as AgentRunStatus,
      })
      .select('id, thread_id, user_id, status, started_at, completed_at, error')
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to start agent run: ${error?.message ?? 'unknown error'}`,
      );
    }

    return rowToAgentRun(data);
  }

  /** Mark a run as completed. Idempotent — safe to call from finally blocks. */
  async completeRun(runId: string): Promise<void> {
    await this.finalize(runId, 'completed', null);
  }

  /** Mark a run as failed with an optional error message. */
  async failRun(runId: string, errorMessage: string): Promise<void> {
    await this.finalize(runId, 'failed', errorMessage);
  }

  /**
   * Mark a run as cancelled. Used when the client disconnects mid-stream
   * (browser tab closed, network drop, useChat.stop() abort) — distinct
   * from `failRun` so dashboards / retry UX can tell user-aborts apart
   * from real failures.
   */
  async cancelRun(runId: string, reason?: string | null): Promise<void> {
    await this.finalize(runId, 'cancelled', reason ?? null);
  }

  /**
   * Look up a single run by id, scoped to `userId`. Returns `null` when
   * the run doesn't exist or doesn't belong to the caller (callers
   * should treat both cases as "not found" so a non-owner can't observe
   * another user's run id space).
   */
  async getRunOwnedBy(
    runId: string,
    userId: string,
  ): Promise<AgentRunRecord | null> {
    const { data, error } = await this.supabase
      .from('agent_runs')
      .select('id, thread_id, user_id, status, started_at, completed_at, error')
      .eq('id', runId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      this.logger.warn(`getRunOwnedBy query failed: ${error.message}`);
      return null;
    }
    return data ? rowToAgentRun(data) : null;
  }

  /**
   * Look up the latest run on a thread. Used by the active-run endpoint so
   * the frontend can decide whether to reconnect, show a retry affordance,
   * or just render history from the messages table.
   *
   * Scoped by `user_id` so a non-owner gets a flat "idle" response and
   * never learns about another user's runs.
   */
  async getActiveRun(threadId: string, userId: string): Promise<ActiveRunDto> {
    const { data, error } = await this.supabase
      .from('agent_runs')
      .select('id, status')
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.warn(`getActiveRun query failed: ${error.message}`);
      return { runId: null, status: 'idle' };
    }
    if (!data) {
      return { runId: null, status: 'idle' };
    }
    return { runId: data.id, status: data.status as AgentRunStatus };
  }

  private async finalize(
    runId: string,
    status: Exclude<AgentRunStatus, 'running'>,
    errorMessage: string | null,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('agent_runs')
      .update({
        status,
        completed_at: new Date().toISOString(),
        error: errorMessage,
      })
      .eq('id', runId);

    if (error) {
      this.logger.warn(
        `Failed to finalize run ${runId} as ${status}: ${error.message}`,
      );
    }
  }
}
