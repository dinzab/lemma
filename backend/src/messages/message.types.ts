/**
 * Conversation roles persisted on `public.messages`. Mirrors the CHECK
 * constraint defined in migration 002.
 */
export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface MessageRecord {
  id: string;
  threadId: string;
  runId: string | null;
  userId: string;
  role: MessageRole;
  content: string;
  /**
   * Streamed chain-of-thought captured between `reasoning-start` and
   * `reasoning-end` while the assistant turn was live. Empty string for
   * non-assistant rows and for assistant rows whose model didn't emit
   * any reasoning (most providers other than NIM / o1 etc.). Populated
   * here so reload reproduces the same `<Reasoning>` collapsible the
   * user saw during streaming.
   */
  reasoning: string;
  toolName: string | null;
  toolCallId: string | null;
  toolInput: unknown;
  toolOutput: unknown;
  tokenCount: number | null;
  sequence: number;
  createdAt: Date;
}

export interface MessagesPage {
  messages: MessageRecord[];
  /** id of the oldest message returned, or null when no more pages exist. */
  nextCursor: string | null;
  /** total messages currently stored on the thread. */
  total: number;
}

export interface GetMessagesPageOptions {
  limit?: number;
  /** id of the message returned at the top of the previous page. */
  before?: string;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  run_id: string | null;
  user_id: string;
  role: MessageRole;
  content: string;
  /** See MessageRecord.reasoning. Nullable on the wire only because the
   * column was added after the initial schema; we coerce to '' below. */
  reasoning: string | null;
  tool_name: string | null;
  tool_call_id: string | null;
  tool_input: unknown;
  tool_output: unknown;
  token_count: number | null;
  sequence: number;
  created_at: string;
}

export function rowToMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    runId: row.run_id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning ?? '',
    toolName: row.tool_name,
    toolCallId: row.tool_call_id,
    toolInput: row.tool_input,
    toolOutput: row.tool_output,
    tokenCount: row.token_count,
    sequence: row.sequence,
    createdAt: new Date(row.created_at),
  };
}
