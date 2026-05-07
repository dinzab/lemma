import { Injectable, Logger } from '@nestjs/common';
import { AIMessageChunk } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
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
 *   - Persistence of conversation rows into `public.messages` while the
 *     LangGraph checkpointer continues to drive agent memory + resumption
 *   - The Vercel AI SDK v5 UI message stream wire protocol
 *
 * Wire + persistence are aligned: every assistant text segment streamed
 * between two tool-call boundaries is also persisted as its own
 * `role: 'assistant'` row at that boundary, so on reload the message
 * sequence reproduces the original text/tool/text/tool/text interleaving
 * the user saw live. Tool calls land as `role: 'tool'` rows whose
 * `sequence` slots in between the surrounding text rows.
 *
 * Persistence and the wire protocol are decoupled enough that a failed DB
 * write logs and continues so the user still gets a streamed reply, and a
 * failed stream still marks the run `failed` in agent_runs.
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
   *   3. Per text segment (between two tool-call boundaries): insert an
   *      `assistant` row with that segment's content.
   *   4. Per tool call: insert a `tool` row when input arrives, patch its
   *      `tool_output` when the result arrives.
   *   5. On success: mark run `completed`.
   *   6. On error: persist any in-flight text segment + mark run `failed`.
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
        // The current open text part on the wire. Each tool-call boundary
        // closes it; the next text-delta opens a fresh one with a new id.
        // This is what makes tools render INLINE between text segments
        // instead of clumping at the end of one big text part.
        let activeTextId: string | null = null;
        let activeTextBuffer = '';
        // Tracks whether `messages`-mode already streamed text for this turn.
        // When true we skip emitting the same content again from the
        // `updates`-mode AIMessage at the end of the node, which carries the
        // full reply and would otherwise duplicate every assistant message.
        let textStreamedViaMessages = false;
        // Map tool_call_id → messages row id so we can patch tool_output
        // when the corresponding ToolMessage arrives later in the stream.
        const toolRowByCallId = new Map<string, string>();
        // Tool calls we've already announced via `tool-input-available`.
        // The AI SDK rejects `tool-output-available` for any callId it
        // hasn't seen registered first (`No tool invocation found …`),
        // so we guard every output emission against this set and emit
        // a synthetic input event when needed.
        const announcedInputs = new Set<string>();
        // Cached metadata for any tool call we've seen at least once,
        // populated from both `messages`-mode chunks and `updates`-mode
        // full AIMessages. Used to recover toolName / args when an
        // output event arrives before its matching input event.
        const knownToolCalls = new Map<
          string,
          { toolName: string; input: unknown }
        >();

        // Open the wire envelope unconditionally so even tool-only or
        // error-only turns produce a well-formed `start … finish` stream.
        writer.write({ type: 'start' });

        const openText = () => {
          if (activeTextId !== null) return;
          activeTextId = randomUUID();
          activeTextBuffer = '';
          writer.write({ type: 'text-start', id: activeTextId });
        };

        // Close the current text part on the wire AND persist its content
        // as an `assistant` row. Called at every tool-call boundary and at
        // end-of-turn — no-op if no text is currently open.
        const closeTextSegment = async () => {
          if (activeTextId === null) return;
          writer.write({ type: 'text-end', id: activeTextId });
          const buffered = activeTextBuffer;
          activeTextId = null;
          activeTextBuffer = '';
          if (buffered.trim().length === 0) return;
          try {
            await this.messages.insertMessage({
              threadId,
              runId: run.id,
              userId,
              role: 'assistant',
              content: buffered,
            });
          } catch (err) {
            this.logger.warn(
              `Failed to persist assistant segment for run ${run.id}: ` +
                String(err),
            );
          }
        };

        const announceToolInput = async (
          callId: string,
          toolName: string,
          input: unknown,
        ): Promise<void> => {
          if (announcedInputs.has(callId)) return;
          // Close + persist any active text segment BEFORE announcing the
          // tool — both on the wire and in the DB sequence — so reload
          // reconstructs the same text/tool ordering the user saw live.
          await closeTextSegment();
          writer.write({
            type: 'tool-input-available',
            toolCallId: callId,
            toolName,
            input,
            dynamic: true,
          });
          announcedInputs.add(callId);
          if (!toolRowByCallId.has(callId)) {
            try {
              const row = await this.messages.insertMessage({
                threadId,
                runId: run.id,
                userId,
                role: 'tool',
                content: '',
                toolName,
                toolCallId: callId,
                toolInput: (input ?? {}) as unknown,
              });
              toolRowByCallId.set(callId, row.id);
            } catch (err) {
              this.logger.warn(
                `Failed to persist tool call ${callId} ` +
                  `(${toolName}): ${String(err)}`,
              );
            }
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
                  openText();
                  textStreamedViaMessages = true;
                  activeTextBuffer += delta;
                  writer.write({
                    type: 'text-delta',
                    id: activeTextId!,
                    delta,
                  });
                }
                // Tool call args may also stream via `messages` mode as
                // `tool_call_chunks` on the AIMessageChunk. We don't
                // forward partial input deltas to the wire (the AI SDK
                // protocol expects them to be paired with a stable id
                // we may not have yet), but we do harvest the fully
                // assembled `tool_calls` so we can announce inputs as
                // soon as they're known — without depending on the
                // matching `updates`-mode AIMessage payload arriving
                // first.
                for (const tc of chunk.tool_calls ?? []) {
                  if (!tc.id || !tc.name) continue;
                  knownToolCalls.set(tc.id, {
                    toolName: tc.name,
                    input: tc.args ?? {},
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
                  // Duck-typing instead of `instanceof` is intentional:
                  // `@langchain/core` and `@langchain/langgraph` each
                  // bundle their own copy of the message classes, so a
                  // message returned from a graph node may have the
                  // shape of an AIMessage but a prototype that doesn't
                  // match the import we'd compare against (see the
                  // matching note in `nodes/router.ts`). Without this,
                  // the AIMessage branch silently misses tool_calls
                  // and the AI SDK throws "No tool invocation found"
                  // when the matching ToolMessage arrives.
                  const kind = (m as { _getType?: () => string })._getType?.();
                  if (kind === 'ai') {
                    const ai = m as unknown as {
                      content: unknown;
                      tool_calls?: Array<{
                        id?: string;
                        name: string;
                        args?: Record<string, unknown>;
                      }>;
                    };
                    const toolCalls = ai.tool_calls ?? [];
                    if (toolCalls.length > 0) {
                      for (const tc of toolCalls) {
                        const callId = tc.id ?? randomUUID();
                        const args = (tc.args ?? {}) as unknown;
                        knownToolCalls.set(callId, {
                          toolName: tc.name,
                          input: args,
                        });
                        await announceToolInput(callId, tc.name, args);
                      }
                      continue;
                    }
                    if (!textStreamedViaMessages) {
                      // AIMessage without tool_calls — covers the chat
                      // node's fallback error reply and any non-streamed
                      // assistant turn. Skip when messages-mode already
                      // streamed the same content to avoid duplicates.
                      const text =
                        typeof ai.content === 'string'
                          ? ai.content
                          : JSON.stringify(ai.content);
                      if (text) {
                        openText();
                        activeTextBuffer += text;
                        writer.write({
                          type: 'text-delta',
                          id: activeTextId!,
                          delta: text,
                        });
                      }
                    }
                    continue;
                  }
                  if (kind === 'tool') {
                    const tool = m as unknown as {
                      tool_call_id?: string;
                      content: unknown;
                    };
                    const callId = tool.tool_call_id;
                    if (!callId) continue;
                    const output =
                      typeof tool.content === 'string'
                        ? safeParse(tool.content)
                        : tool.content;
                    // Defensive: if the matching input never arrived
                    // (different langchain copies, missed update,
                    // etc.) synthesise it from whatever we know about
                    // the call so the AI SDK can place the output.
                    if (!announcedInputs.has(callId)) {
                      const known = knownToolCalls.get(callId);
                      await announceToolInput(
                        callId,
                        known?.toolName ?? 'tool',
                        known?.input ?? {},
                      );
                    }
                    writer.write({
                      type: 'tool-output-available',
                      toolCallId: callId,
                      output,
                      dynamic: true,
                    });
                    const rowId = toolRowByCallId.get(callId);
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
                  }
                }
              }
            }
          }
        } catch (err) {
          // Persist whatever's still buffered as a final assistant segment
          // and mark the run failed before re-raising so the SDK's
          // `onError` handler can surface the failure to the client.
          await closeTextSegment();
          await this.agentRuns.failRun(run.id, errorMessage(err));
          throw err;
        }

        // Flush the trailing text segment (the model's final answer).
        await closeTextSegment();
        await this.agentRuns.completeRun(run.id);
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
    runId: message.runId,
    createdAt: message.createdAt.toISOString(),
  };

  if (message.role === 'tool') {
    return {
      ...base,
      toolCallId: message.toolCallId ?? undefined,
      toolName: message.toolName ?? undefined,
      toolInput: message.toolInput ?? undefined,
      toolOutput: message.toolOutput ?? undefined,
    };
  }

  return base;
}
