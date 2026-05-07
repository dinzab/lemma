import { Injectable, Logger } from '@nestjs/common';
import { AIMessageChunk } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  type UIMessageChunk,
} from 'ai';
import type { ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { AgentService } from '../agent/agent.service';
import { ThreadsService } from '../threads/threads.service';
import {
  AgentRunsService,
  RunStreamHub,
  type AgentRunRecord,
} from '../agent-runs';
import { MessagesService, type MessageRecord } from '../messages';
import type { MessageDto, MessagesPageDto } from './dto';

/**
 * ChatService — orchestrates the live streaming run, the resumable
 * playback path, and the paginated read path. It owns:
 *
 *   - Lifecycle bookkeeping for `public.agent_runs`
 *     (start / complete / fail / cancel)
 *   - Persistence of conversation rows into `public.messages` while the
 *     LangGraph checkpointer continues to drive agent memory + resumption
 *   - The Vercel AI SDK UI message stream wire protocol
 *   - Mirroring every wire chunk into `RunStreamHub` so a reload or a
 *     transient disconnect can re-attach to the same in-flight stream
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
    private readonly hub: RunStreamHub,
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
   *   6. On client disconnect / explicit stop: mark run `cancelled`.
   *   7. On error: persist any in-flight text segment + mark run `failed`.
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

    // Cancel the LangGraph stream when the client closes the underlying
    // socket (browser tab closed, network drop, useChat.stop()).
    // Without this the agent keeps consuming tokens and writing rows
    // long after the user has gone.
    const abortController = new AbortController();
    let clientDisconnected = false;
    const onClose = () => {
      clientDisconnected = true;
      if (!abortController.signal.aborted) abortController.abort();
    };
    response.on('close', onClose);

    // Resolve once the agent loop's body has fully run (including its
    // catch / cleanup branch). We need this on top of the response
    // `finish`/`close` events because a premature client disconnect
    // fires `close` BEFORE the catch block has had a chance to call
    // `cancelRun` + `hub.close`.
    let resolveExecuteDone: () => void = () => undefined;
    const executeDone = new Promise<void>((resolve) => {
      resolveExecuteDone = resolve;
    });

    const stream = this.buildAgentStream({
      run,
      message,
      hubPublish: (chunk) => this.hub.publish(run.id, chunk),
      abortSignal: abortController.signal,
      isClientDisconnected: () => clientDisconnected,
      onExecuteDone: () => resolveExecuteDone(),
    });

    // The pipe helper returns void and writes asynchronously, so we wrap
    // it in a Promise that resolves on `finish`/`close`. Combined with
    // `executeDone` this guarantees the controller only returns once
    // both the wire and the agent bookkeeping are settled.
    await new Promise<void>((resolve) => {
      const done = () => {
        response.off('finish', done);
        response.off('close', done);
        resolve();
      };
      response.on('finish', done);
      response.on('close', done);
      pipeUIMessageStreamToResponse({ response, stream });
    });

    await executeDone;
    response.off('close', onClose);
  }

  /**
   * Resume a previously-started turn by re-attaching to its `RunStreamHub`
   * channel. The wire protocol is identical to a fresh `/chat/stream`
   * response — the AI SDK `useChat` hook reading from this endpoint can
   * keep parsing chunks the way it normally does.
   *
   * Behaviour:
   *
   *   - If the run is still `running` and in the hub, replays every
   *     buffered chunk in order (so the client picks up exactly where
   *     it left off in terms of streamed deltas) and then forwards
   *     live chunks until the run terminates.
   *
   *   - If the run is no longer in the hub (server restarted, eviction
   *     TTL elapsed) we emit a `start … finish` envelope with no body
   *     so the SDK doesn't hang. The client falls back to the persisted
   *     history endpoint for content.
   *
   *   - Ownership is enforced by the controller via `getOwnedRun`.
   */
  async resumeRunToResponse(opts: {
    runId: string;
    response: ServerResponse;
  }): Promise<void> {
    const { runId, response } = opts;

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        let sawStart = false;
        let sawFinish = false;
        for await (const event of this.hub.subscribe(runId)) {
          if (event.kind === 'chunk') {
            const chunk = event.chunk as UIMessageChunk;
            const t = (chunk as { type?: string }).type;
            if (t === 'start') sawStart = true;
            if (t === 'finish') sawFinish = true;
            writer.write(chunk);
            continue;
          }
          // Channel closed. The original publisher already wrote
          // `finish` on success — but if we re-attached AFTER eviction
          // the buffer is empty and we still need a well-formed
          // envelope so the SDK doesn't hang the response.
          if (event.reason === 'failed' && event.error) {
            this.logger.warn(
              `Resume of run ${runId} ended with failure: ${event.error}`,
            );
          }
          if (!sawStart) writer.write({ type: 'start' });
          if (!sawFinish) writer.write({ type: 'finish' });
          return;
        }
      },
      onError: (err) => {
        this.logger.error(`resume execute failed: ${String(err)}`);
        return 'The tutor is temporarily unavailable. Please retry.';
      },
    });

    await new Promise<void>((resolve) => {
      const done = () => {
        response.off('finish', done);
        response.off('close', done);
        resolve();
      };
      response.on('finish', done);
      response.on('close', done);
      pipeUIMessageStreamToResponse({ response, stream });
    });
  }

  /**
   * Verify that the `agent_runs` row belongs to `userId` and return the
   * record. Used by the resume endpoint before subscribing to the hub.
   */
  async getOwnedRun(
    runId: string,
    userId: string,
  ): Promise<AgentRunRecord | null> {
    return this.agentRuns.getRunOwnedBy(runId, userId);
  }

  private buildAgentStream(opts: {
    run: AgentRunRecord;
    message: string;
    hubPublish: (chunk: UIMessageChunk) => void;
    abortSignal: AbortSignal;
    isClientDisconnected: () => boolean;
    onExecuteDone?: () => void;
  }) {
    const {
      run,
      message,
      hubPublish,
      abortSignal,
      isClientDisconnected,
      onExecuteDone,
    } = opts;
    const { id: runId, threadId, userId } = run;
    const startedAt = Date.now();
    let chunkCount = 0;
    let toolCallCount = 0;

    return createUIMessageStream({
      execute: async ({ writer }) => {
        try {
        // Tee writer: every chunk going to the live response is also
        // pushed into the hub so a resume subscriber sees the same
        // ordered stream.
        const teeWrite = (chunk: UIMessageChunk): void => {
          chunkCount += 1;
          writer.write(chunk);
          hubPublish(chunk);
        };

        // The current open text part on the wire. Each tool-call boundary
        // closes it; the next text-delta opens a fresh one with a new id.
        // This is what makes tools render INLINE between text segments
        // instead of clumping at the end of one big text part.
        let activeTextId: string | null = null;
        let activeTextBuffer = '';
        // AIMessage ids whose content already streamed via `messages` mode.
        // The matching AIMessage shows up again at the end of `updates`
        // mode and would otherwise duplicate every assistant turn — but
        // if the chat node fails AFTER a partial stream and synthesises a
        // fallback AIMessage with a fresh id we MUST emit it (id mismatch
        // ⇒ different message). This generalises the old
        // `textStreamedViaMessages` flag, which dropped the fallback.
        const streamedAiMessageIds = new Set<string>();
        let activeReasoningId: string | null = null;
        const streamedReasoningIds = new Set<string>();
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
        teeWrite({ type: 'start' });

        const openText = () => {
          if (activeTextId !== null) return;
          activeTextId = randomUUID();
          activeTextBuffer = '';
          teeWrite({ type: 'text-start', id: activeTextId });
        };

        // Close the current text part on the wire AND persist its content
        // as an `assistant` row. Called at every tool-call boundary and at
        // end-of-turn — no-op if no text is currently open.
        const closeTextSegment = async () => {
          if (activeTextId === null) return;
          teeWrite({ type: 'text-end', id: activeTextId });
          const buffered = activeTextBuffer;
          activeTextId = null;
          activeTextBuffer = '';
          if (buffered.trim().length === 0) return;
          try {
            await this.messages.insertMessage({
              threadId,
              runId,
              userId,
              role: 'assistant',
              content: buffered,
            });
          } catch (err) {
            this.logger.warn(
              `Failed to persist assistant segment for run ${runId}: ${String(err)}`,
            );
          }
        };

        const openReasoning = (id: string) => {
          if (activeReasoningId !== null) return;
          activeReasoningId = id;
          teeWrite({ type: 'reasoning-start', id });
        };

        const closeReasoning = () => {
          if (activeReasoningId === null) return;
          teeWrite({ type: 'reasoning-end', id: activeReasoningId });
          activeReasoningId = null;
        };

        const announceToolInput = async (
          callId: string,
          toolName: string,
          input: unknown,
        ): Promise<void> => {
          if (announcedInputs.has(callId)) return;
          // Close + persist any active text / reasoning segment BEFORE
          // announcing the tool — both on the wire and in the DB
          // sequence — so reload reconstructs the same ordering the
          // user saw live.
          await closeTextSegment();
          closeReasoning();
          teeWrite({
            type: 'tool-input-available',
            toolCallId: callId,
            toolName,
            input,
            dynamic: true,
          });
          announcedInputs.add(callId);
          toolCallCount += 1;
          if (!toolRowByCallId.has(callId)) {
            try {
              const row = await this.messages.insertMessage({
                threadId,
                runId,
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
                `Failed to persist tool call ${callId} (${toolName}): ${String(err)}`,
              );
            }
          }
        };

        try {
          for await (const event of this.agent.streamRun(
            threadId,
            message,
            abortSignal,
          )) {
            if (event.mode === 'messages') {
              // Tuple of [chunk, metadata] from streamMode=messages.
              const tuple = event.payload as [
                AIMessageChunk | unknown,
                unknown,
              ];
              const chunk = tuple[0];
              if (chunk instanceof AIMessageChunk) {
                const chunkId = (chunk as { id?: string }).id;
                if (chunkId) streamedAiMessageIds.add(chunkId);

                const reasoningDelta = extractReasoningDelta(chunk);
                if (reasoningDelta) {
                  const rid = chunkId ?? `reasoning-${runId}`;
                  streamedReasoningIds.add(rid);
                  openReasoning(rid);
                  if (activeReasoningId) {
                    teeWrite({
                      type: 'reasoning-delta',
                      id: activeReasoningId,
                      delta: reasoningDelta,
                    });
                  }
                }

                const delta = chunkToText(chunk);
                if (delta) {
                  // Switching from reasoning → answer: close the
                  // reasoning part so the AI SDK ends the "Thinking…"
                  // shimmer before the answer text streams in.
                  closeReasoning();
                  openText();
                  activeTextBuffer += delta;
                  if (activeTextId) {
                    teeWrite({
                      type: 'text-delta',
                      id: activeTextId,
                      delta,
                    });
                  }
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
                      id?: string;
                      content: unknown;
                      tool_calls?: Array<{
                        id?: string;
                        name: string;
                        args?: Record<string, unknown>;
                      }>;
                      additional_kwargs?: { reasoning_content?: unknown };
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
                    // AIMessage without tool_calls — the chat node's
                    // final answer (already streamed via `messages`
                    // mode) OR the chat node's fallback error reply
                    // (synthesised inside try/catch and never streamed).
                    // Dedupe on AIMessage id so a fresh id (= different
                    // message) is emitted instead of silently dropped.
                    if (ai.id && streamedAiMessageIds.has(ai.id)) continue;

                    // A reasoning_content field on the full AIMessage
                    // (as opposed to streamed via tokens) shows up here
                    // when the provider emits reasoning as a single
                    // post-stream blob.
                    const reasoning =
                      typeof ai.additional_kwargs?.reasoning_content ===
                      'string'
                        ? ai.additional_kwargs.reasoning_content
                        : '';
                    if (
                      reasoning &&
                      (!ai.id || !streamedReasoningIds.has(ai.id))
                    ) {
                      const rid = ai.id ?? `reasoning-${randomUUID()}`;
                      openReasoning(rid);
                      if (activeReasoningId) {
                        teeWrite({
                          type: 'reasoning-delta',
                          id: activeReasoningId,
                          delta: reasoning,
                        });
                      }
                      closeReasoning();
                    }

                    const text =
                      typeof ai.content === 'string'
                        ? ai.content
                        : JSON.stringify(ai.content);
                    if (text) {
                      // Anything already buffered into the active text
                      // segment is from a different (likely partial)
                      // AIMessage that streamed earlier in this turn —
                      // close it so the fallback / final reply gets its
                      // own segment in both wire and DB.
                      await closeTextSegment();
                      openText();
                      activeTextBuffer += text;
                      if (activeTextId) {
                        teeWrite({
                          type: 'text-delta',
                          id: activeTextId,
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
                    teeWrite({
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
          await closeTextSegment();
          closeReasoning();
          if (isAbortError(err) || isClientDisconnected()) {
            await this.agentRuns.cancelRun(
              runId,
              isClientDisconnected()
                ? 'Client disconnected.'
                : 'Run was cancelled.',
            );
            try {
              teeWrite({ type: 'finish' });
            } catch {
              /* response already gone */
            }
            this.hub.close(runId, 'cancelled');
            this.logger.log(
              `run=${runId} thread=${threadId} cancelled after ` +
                `${Date.now() - startedAt}ms chunks=${chunkCount} ` +
                `tools=${toolCallCount}`,
            );
            return;
          }
          await this.agentRuns.failRun(runId, errorMessage(err));
          this.hub.close(runId, 'failed', errorMessage(err));
          this.logger.error(
            `run=${runId} thread=${threadId} failed after ` +
              `${Date.now() - startedAt}ms chunks=${chunkCount} ` +
              `tools=${toolCallCount}: ${errorMessage(err)}`,
          );
          throw err;
        }

        // Flush the trailing text / reasoning segments (the model's
        // final answer).
        await closeTextSegment();
        closeReasoning();
        await this.agentRuns.completeRun(runId);
        teeWrite({ type: 'finish' });
        this.hub.close(runId, 'completed');
        this.logger.log(
          `run=${runId} thread=${threadId} completed in ` +
            `${Date.now() - startedAt}ms chunks=${chunkCount} ` +
            `tools=${toolCallCount}`,
        );
        } finally {
          onExecuteDone?.();
        }
      },
      onError: (err) => {
        this.logger.error(`stream execute failed: ${String(err)}`);
        return 'The tutor is temporarily unavailable. Please retry.';
      },
    });
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

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error && err.name === 'AbortError') return true;
  const obj = err as { name?: string; code?: string };
  return obj.name === 'AbortError' || obj.code === 'ABORT_ERR';
}

/**
 * Extract a reasoning delta from a streamed AIMessageChunk. Different
 * providers surface chain-of-thought through different fields; we pull
 * from the standardised LangChain `additional_kwargs.reasoning_content`
 * (NVIDIA NIM / OpenAI o1 family) and accept either a string or a list
 * of `{ text }` parts.
 */
function extractReasoningDelta(chunk: AIMessageChunk): string {
  const ak = (chunk as { additional_kwargs?: Record<string, unknown> })
    .additional_kwargs;
  if (!ak) return '';
  const raw = ak.reasoning_content;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((part) =>
        typeof part === 'string'
          ? part
          : part &&
              typeof part === 'object' &&
              'text' in (part as Record<string, unknown>) &&
              typeof (part as { text?: unknown }).text === 'string'
            ? (part as { text: string }).text
            : '',
      )
      .join('');
  }
  return '';
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
