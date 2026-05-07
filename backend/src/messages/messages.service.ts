import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  GetMessagesPageOptions,
  MessageRecord,
  MessageRole,
  MessageRow,
  MessagesPage,
  rowToMessage,
} from './message.types';

/**
 * MessagesService — owns the flat `public.messages` table that powers the
 * UI history endpoint. ChatService dual-writes here while the LangGraph
 * checkpointer continues to drive agent memory + resumption (so the two
 * concerns are cleanly separated, matching the architecture proposal).
 *
 * Per-thread `sequence` is computed at insert time inside a single SQL
 * statement so concurrent inserts within a single thread don't collide
 * (the `(thread_id, sequence)` UNIQUE constraint is the safety net — a
 * collision would surface as an INSERT failure that the caller can retry).
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private readonly supabase: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.getOrThrow<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );
    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  /**
   * Insert a message row, computing `sequence` as `MAX(sequence)+1` for
   * the thread. Returns the persisted row so the caller can attach the
   * generated id to subsequent events.
   *
   * Concurrent inserts on the same thread (rare but possible: an HTTP
   * retry races the original, two browser tabs send simultaneously,
   * etc.) used to silently fail the loser with a `(thread_id, sequence)`
   * unique-constraint violation, leaving holes in the persisted history.
   * We retry the read-max + insert pair on the well-known PostgREST
   * `23505` code so concurrent inserts each get a fresh sequence.
   */
  async insertMessage(input: {
    threadId: string;
    runId: string | null;
    userId: string;
    role: MessageRole;
    content?: string;
    toolName?: string | null;
    toolCallId?: string | null;
    toolInput?: unknown;
    toolOutput?: unknown;
    tokenCount?: number | null;
  }): Promise<MessageRecord> {
    const MAX_ATTEMPTS = 5;
    let lastError: { code?: string; message: string } | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data: maxRow, error: maxErr } = await this.supabase
        .from('messages')
        .select('sequence')
        .eq('thread_id', input.threadId)
        .order('sequence', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxErr) {
        throw new Error(
          `Failed to read sequence for thread ${input.threadId}: ${maxErr.message}`,
        );
      }
      const nextSequence = (maxRow?.sequence ?? -1) + 1;

      const { data, error } = await this.supabase
        .from('messages')
        .insert({
          thread_id: input.threadId,
          run_id: input.runId,
          user_id: input.userId,
          role: input.role,
          content: input.content ?? '',
          tool_name: input.toolName ?? null,
          tool_call_id: input.toolCallId ?? null,
          tool_input: input.toolInput ?? null,
          tool_output: input.toolOutput ?? null,
          token_count: input.tokenCount ?? null,
          sequence: nextSequence,
        })
        .select(
          'id, thread_id, run_id, user_id, role, content, ' +
            'tool_name, tool_call_id, tool_input, tool_output, ' +
            'token_count, sequence, created_at',
        )
        .single();

      if (data) {
        return rowToMessage(data as unknown as MessageRow);
      }

      const err = error as { code?: string; message: string } | null;
      lastError = err;
      // 23505 = unique_violation. Anything else (RLS denial, network,
      // schema problem) won't be cured by a retry, so fail fast.
      if (err?.code !== '23505') {
        throw new Error(
          `Failed to insert message: ${err?.message ?? 'unknown error'}`,
        );
      }
      this.logger.debug(
        `Sequence collision on thread ${input.threadId} ` +
          `(attempt ${attempt + 1}/${MAX_ATTEMPTS}); retrying.`,
      );
    }

    throw new Error(
      `Failed to insert message after ${MAX_ATTEMPTS} sequence-retry attempts: ` +
        (lastError?.message ?? 'unknown error'),
    );
  }

  /**
   * Update the content + token_count on an existing message row. Used at
   * the end of a streaming turn to persist the assembled assistant text
   * (the row was inserted at the start of streaming with empty content
   * so the run_id linkage is captured even if the stream errors).
   */
  async finalizeAssistantMessage(input: {
    messageId: string;
    content: string;
    tokenCount?: number | null;
  }): Promise<void> {
    const { error } = await this.supabase
      .from('messages')
      .update({
        content: input.content,
        token_count: input.tokenCount ?? null,
      })
      .eq('id', input.messageId);

    if (error) {
      this.logger.warn(
        `Failed to finalize assistant message ${input.messageId}: ${error.message}`,
      );
    }
  }

  /**
   * Update the `tool_output` of an existing tool message row. Tool calls
   * are inserted with input only (we don't yet have the result), then
   * patched when the corresponding `tool-output-available` event fires.
   */
  async setToolOutput(input: {
    messageId: string;
    toolOutput: unknown;
  }): Promise<void> {
    const { error } = await this.supabase
      .from('messages')
      .update({ tool_output: input.toolOutput })
      .eq('id', input.messageId);

    if (error) {
      this.logger.warn(
        `Failed to set tool_output on ${input.messageId}: ${error.message}`,
      );
    }
  }

  /**
   * Cursor-paginated read of a thread's messages. Newest-first. Cursor is
   * the id of the oldest message returned previously; pass it back as
   * `before` to walk further into history.
   *
   * Caller is responsible for ownership validation — typically by
   * resolving the thread through `ThreadsService.getThread` first so a
   * non-owner gets a flat 404.
   */
  async getThreadMessages(
    threadId: string,
    opts: GetMessagesPageOptions = {},
  ): Promise<MessagesPage> {
    const limit = clampLimit(opts.limit);

    // Resolve cursor → upper bound on `sequence`. If the cursor's
    // sequence cannot be resolved (e.g. message deleted), be defensive
    // and return the latest page rather than an empty result.
    let beforeSequence: number | null = null;
    if (opts.before) {
      const { data: cursorRow } = await this.supabase
        .from('messages')
        .select('sequence')
        .eq('id', opts.before)
        .eq('thread_id', threadId)
        .maybeSingle();
      if (cursorRow) {
        beforeSequence = cursorRow.sequence;
      }
    }

    let query = this.supabase
      .from('messages')
      .select(
        'id, thread_id, run_id, user_id, role, content, ' +
          'tool_name, tool_call_id, tool_input, tool_output, ' +
          'token_count, sequence, created_at',
      )
      .eq('thread_id', threadId)
      .order('sequence', { ascending: false })
      .limit(limit);

    if (beforeSequence !== null) {
      query = query.lt('sequence', beforeSequence);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(
        `Failed to read messages for thread ${threadId}: ${error.message}`,
      );
    }

    const messages = ((data ?? []) as unknown as MessageRow[]).map(
      rowToMessage,
    );

    const { count, error: countError } = await this.supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId);
    if (countError) {
      this.logger.warn(
        `Failed to count messages for thread ${threadId}: ${countError.message}`,
      );
    }

    // Cursor = id of the oldest message in this page. Null when the page
    // is empty or fewer messages than `limit` came back (no more history).
    const nextCursor =
      messages.length === limit && messages.length > 0
        ? messages[messages.length - 1].id
        : null;

    return {
      messages,
      nextCursor,
      total: count ?? messages.length,
    };
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.floor(limit));
}
