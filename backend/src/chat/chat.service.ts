import { Injectable, Logger } from '@nestjs/common';
import {
  AIMessage,
  AIMessageChunk,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import type { ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { AgentService } from '../agent/agent.service';
import { ThreadsService } from '../threads/threads.service';
import { AgentRunsService } from '../agent-runs';
import { MessagesService, type MessageRecord } from '../messages';
import type { MessageDto, MessagesPageDto } from './dto';

/**
 * ChatService — orchestrates the live streaming run and the paginated read
 * path. It owns:
 *
 *   - Lifecycle bookkeeping for `public.agent_runs` (start/complete/fail)
 *   - Dual-write of conversation rows into `public.messages` while the
 *     LangGraph checkpointer continues to drive agent memory + resumption
 *   - The Vercel AI SDK v5 UI message stream wire protocol (unchanged)
 *
 * Persistence and the wire protocol are deliberately decoupled: a failed
 * DB write logs and continues so the user still gets a streamed reply,
 * and a failed stream still marks the run `failed` in agent_runs.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly agent: AgentService,
    private readonly threads: ThreadsService,
    private readonly agentRuns: AgentRunsService,
    private readonly messages: MessagesService,
  ) {}

  /**
   * Pipe a Vercel AI SDK UI message stream for a single agent turn into the
   * given Express response. Validates thread ownership first; the controller
   * surfaces the throw as a 403 / 404 / 500 before any SSE bytes go out.
   *
   * Persistence side-effects, in order:
   *   1. Open `agent_runs` row (status='running').
   *   2. Insert user `messages` row.
   *   3. Per tool call: insert a `tool` row when input arrives, patch its
   *      `tool_output` when the result arrives.
   *   4. On success: insert assembled assistant `messages` row + mark run
   *      `completed`.
   *   5. On error: insert (possibly empty) assistant row with whatever was
   *      streamed so far + mark run `failed` with the error message.
   */
  async streamRunToResponse(opts: {
    threadId: string;
    userId: string;
    message: string;
    response: ServerResponse;
  }): Promise<void> {
    const { threadId, userId, message, response } = opts;

    // Throws ThreadNotFoundException — let the controller's exception
    // filters render the right HTTP status before the stream opens.
    await this.threads.getThread(threadId, userId);

    // Open the run + persist the user turn before opening the stream so a
    // crash mid-pipe still leaves a recoverable `running` row that boot
    // recovery can later mark `failed`.
    const run = await this.agentRuns.startRun({ threadId, userId });
    try {
      await this.messages.insertMessage({
        threadId,
        runId: run.id,
        userId,
        role: 'user',
        content: message,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist user message for run ${run.id}: ${String(err)}`,
      );
    }

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Surface a stable id for the assistant's reply turn so the client
        // can correlate streamed deltas to a single message bubble.
        const turnId = randomUUID();
        let textOpen = false;
        // Tracks whether `messages`-mode already streamed text for this turn.
        // When true we skip emitting the same content again from the
        // `updates`-mode AIMessage at the end of the node, which carries the
        // full reply and would otherwise duplicate every assistant message.
        let textStreamedViaMessages = false;
        // Accumulator for the final assistant text. Streamed deltas are
        // appended here; on `done` we persist the full string in one row.
        let assistantText = '';
        // Map tool_call_id → messages row id so we can patch tool_output
        // when the corresponding ToolMessage arrives later in the stream.
        const toolRowByCallId = new Map<string, string>();

        const openTextOnce = () => {
          if (!textOpen) {
            writer.write({ type: 'start' });
            writer.write({ type: 'text-start', id: turnId });
            textOpen = true;
          }
        };

        try {
          for await (const event of this.agent.streamRun(threadId, message)) {
            if (event.mode === 'messages') {
              // Tuple of [chunk, metadata] from streamMode=messages.
              const tuple = event.payload as [
                AIMessageChunk | unknown,
                unknown,
              ];
              const chunk = tuple[0];
              if (chunk instanceof AIMessageChunk) {
                const delta = chunkToText(chunk);
                if (delta) {
                  openTextOnce();
                  textStreamedViaMessages = true;
                  assistantText += delta;
                  writer.write({
                    type: 'text-delta',
                    id: turnId,
                    delta,
                  });
                }
              }
              continue;
            }

            if (event.mode === 'updates') {
              // Tool call / tool result side-channel. Payload shape:
              //   { node_name: { messages: BaseMessage[] } }
              const updates = event.payload as Record<
                string,
                { messages?: BaseMessage[] }
              >;
              for (const [, stateUpdate] of Object.entries(updates)) {
                for (const m of stateUpdate.messages ?? []) {
                  if (
                    m instanceof AIMessage &&
                    m.tool_calls &&
                    m.tool_calls.length > 0
                  ) {
                    for (const tc of m.tool_calls) {
                      const callId = tc.id ?? randomUUID();
                      writer.write({
                        type: 'tool-input-available',
                        toolCallId: callId,
                        toolName: tc.name,
                        input: tc.args,
                        dynamic: true,
                      });
                      // Persist the tool call as a `tool` message row. We
                      // intentionally store input only here; output is
                      // patched in when the ToolMessage arrives below.
                      try {
                        const row = await this.messages.insertMessage({
                          threadId,
                          runId: run.id,
                          userId,
                          role: 'tool',
                          content: '',
                          toolName: tc.name,
                          toolCallId: callId,
                          toolInput: (tc.args ?? {}) as unknown,
                        });
                        toolRowByCallId.set(callId, row.id);
                      } catch (err) {
                        this.logger.warn(
                          `Failed to persist tool call ${callId} ` +
                            `(${tc.name}): ${String(err)}`,
                        );
                      }
                    }
                  } else if (m instanceof ToolMessage) {
                    const output = safeParse(m.content as string);
                    writer.write({
                      type: 'tool-output-available',
                      toolCallId: m.tool_call_id,
                      output,
                      dynamic: true,
                    });
                    const rowId = toolRowByCallId.get(m.tool_call_id);
                    if (rowId) {
                      try {
                        await this.messages.setToolOutput({
                          messageId: rowId,
                          toolOutput: output,
                        });
                      } catch (err) {
                        this.logger.warn(
                          `Failed to patch tool_output on row ${rowId}: ${String(err)}`,
                        );
                      }
                    }
                  } else if (
                    m instanceof AIMessage &&
                    !textStreamedViaMessages
                  ) {
                    // AIMessage without tool_calls — covers the chat node's
                    // fallback error reply and any non-streamed assistant
                    // turn. We only emit it when nothing came through
                    // `messages` mode for this turn; otherwise LangGraph
                    // would deliver the same content twice (incremental
                    // chunks from the LLM stream + the full message in the
                    // node-level state update).
                    const text =
                      typeof m.content === 'string'
                        ? m.content
                        : JSON.stringify(m.content);
                    if (text) {
                      openTextOnce();
                      assistantText += text;
                      writer.write({
                        type: 'text-delta',
                        id: turnId,
                        delta: text,
                      });
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          // Persist whatever we managed to assemble + mark the run failed
          // before re-raising so the SDK's `onError` handler can surface the
          // failure to the client.
          await this.persistFinalAssistantMessage({
            threadId,
            runId: run.id,
            userId,
            content: assistantText,
          });
          await this.agentRuns.failRun(run.id, errorMessage(err));
          if (textOpen) {
            writer.write({ type: 'text-end', id: turnId });
          }
          throw err;
        }

        // Success path: persist the assembled assistant text in a fresh row.
        // We deliberately DO NOT pre-create an empty assistant row at stream
        // start: that would leak a half-rendered bubble to any reload while
        // the run is still in flight. With a finalize-on-done write the
        // history endpoint stays consistent — either the row is fully
        // persisted, or the active-run endpoint reports `running` and the
        // client knows to wait.
        await this.persistFinalAssistantMessage({
          threadId,
          runId: run.id,
          userId,
          content: assistantText,
        });
        await this.agentRuns.completeRun(run.id);

        if (textOpen) {
          writer.write({ type: 'text-end', id: turnId });
        }
        writer.write({ type: 'finish' });
      },
      onError: (err) => {
        this.logger.error(`stream execute failed: ${String(err)}`);
        return 'The tutor is temporarily unavailable. Please retry.';
      },
    });

    pipeUIMessageStreamToResponse({ response, stream });
  }

  /**
   * Cursor-paginated message read. Newest messages first; pass the returned
   * `nextCursor` back as `before` to walk further into history.
   */
  async getMessagesPage(
    threadId: string,
    userId: string,
    opts: { limit?: number; before?: string },
  ): Promise<MessagesPageDto> {
    await this.threads.getThread(threadId, userId);
    const page = await this.messages.getThreadMessages(threadId, opts);
    return {
      messages: page.messages.map(toMessageDto),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }

  /**
   * Persist the final assistant message row. Tolerates empty content (e.g.
   * an error before any tokens streamed) — the agent_run row carries the
   * authoritative status, while this row gives the UI a stable bubble id
   * tied to the run.
   */
  private async persistFinalAssistantMessage(opts: {
    threadId: string;
    runId: string;
    userId: string;
    content: string;
  }): Promise<void> {
    try {
      await this.messages.insertMessage({
        threadId: opts.threadId,
        runId: opts.runId,
        userId: opts.userId,
        role: 'assistant',
        content: opts.content,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist assistant message for run ${opts.runId}: ${String(err)}`,
      );
    }
  }
}

function chunkToText(chunk: AIMessageChunk): string {
  const c = chunk.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part) =>
        typeof part === 'string'
          ? part
          : 'text' in part && typeof part.text === 'string'
            ? part.text
            : '',
      )
      .join('');
  }
  return '';
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function toMessageDto(message: MessageRecord): MessageDto {
  const base: MessageDto = {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };

  if (message.role === 'tool') {
    return {
      ...base,
      toolCallId: message.toolCallId ?? undefined,
      toolName: message.toolName ?? undefined,
    };
  }

  return base;
}
