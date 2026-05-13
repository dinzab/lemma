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
import { UsageService } from '../usage';
import type { MessageDto, MessagesPageDto } from './dto';

/**
 * ChatService — orchestrates the agent run, the resumable playback
 * path, and the paginated read path. It owns:
 *
 *   - Lifecycle bookkeeping for `public.agent_runs`
 *     (start / complete / fail / cancel)
 *   - Persistence of conversation rows into `public.messages` while the
 *     LangGraph checkpointer continues to drive agent memory + resumption
 *   - The Vercel AI SDK UI message stream wire protocol
 *
 * Architecture: the agent run is **decoupled** from the HTTP response.
 * Once `POST /chat/stream` validates ownership and persists the user
 * message, the agent loop runs in the **background** — every chunk goes
 * into `RunStreamHub` keyed by `runId`, and persistence happens
 * independently of the response. Both `POST /chat/stream` and
 * `GET /chat/stream/resume` then subscribe to the hub and pipe chunks
 * out as a Vercel AI SDK UI message stream. This means a page reload
 * does NOT abort the in-flight run — the next request just re-attaches
 * to the same hub channel. Without this decoupling the `response.close`
 * event would fire on reload, abort the LangGraph stream, and leave
 * the user without an answer.
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
    private readonly usage: UsageService,
  ) {}

  /**
   * Validate ownership, persist the user message, kick off the agent
   * run in the background (publishing to `RunStreamHub`), and pipe the
   * hub's chunks out to `response` as a Vercel AI SDK UI message stream.
   *
   * The agent loop's lifecycle is **independent of the response**: if the
   * client disconnects (page reload, network drop) the response side
   * unwinds but the background loop keeps running, persisting messages
   * and publishing chunks to the hub. A subsequent `GET /chat/stream/resume`
   * picks up exactly where this stream left off — see
   * {@link resumeRunToResponse}.
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

    // Kick off the agent loop in the background. It publishes every wire
    // chunk into the hub and persists messages/tool calls/lifecycle
    // independently of this HTTP response. Errors inside the loop are
    // caught + propagated through `hub.close('failed', …)`, so the
    // returned promise should never reject — but we attach a defensive
    // catch + log just in case so a stray throw doesn't surface as an
    // `unhandledRejection`.
    void this.runAgentAndPublish({ run, message }).catch((err) => {
      this.logger.error(
        `Background agent run ${run.id} crashed: ${String(err)}`,
      );
    });

    // Now stream the same chunks from the hub to the response. This is
    // identical to /chat/stream/resume — the only difference is we just
    // started the run, so the consumer almost always sees live deltas
    // rather than replayed ones.
    await this.streamHubToResponse({ runId: run.id, response });
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
    return this.streamHubToResponse(opts);
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

  /**
   * Subscribe to the hub channel for `runId` and pipe every chunk to
   * `response` as a Vercel AI SDK UI message stream. Used by both the
   * live (`POST /chat/stream`) and resume (`GET /chat/stream/resume`)
   * paths — they only differ in who started the run.
   *
   * Returns once the response has been ended (either because the hub
   * channel closed or because the client disconnected). The background
   * agent loop is unaffected by this method returning early.
   */
  private async streamHubToResponse(opts: {
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
          // Channel closed. The publisher already wrote `finish` on
          // success — but if we re-attached AFTER eviction the buffer
          // is empty and we still need a well-formed envelope so the
          // SDK doesn't hang the response.
          if (event.reason === 'failed' && event.error) {
            this.logger.warn(
              `Hub stream of run ${runId} ended with failure: ${event.error}`,
            );
          }
          if (!sawStart) writer.write({ type: 'start' });
          if (!sawFinish) writer.write({ type: 'finish' });
          return;
        }
      },
      onError: (err) => {
        this.logger.error(`hub stream execute failed: ${String(err)}`);
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
   * Run the agent loop in the background, publishing every wire chunk
   * into the hub and persisting `messages` + `agent_runs` rows as the
   * stream progresses. This function never throws — every error path
   * is captured into `hub.close('failed', …)` + `agentRuns.failRun()`
   * so consumers (live or resumed) see a graceful close.
   *
   * Decoupled from the HTTP response on purpose: a page reload should
   * not abort an in-flight LLM call. Resume re-attaches via the hub.
   */
  private async runAgentAndPublish(opts: {
    run: AgentRunRecord;
    message: string;
  }): Promise<void> {
    const { run, message } = opts;
    const { id: runId, threadId, userId } = run;
    const startedAt = Date.now();
    let chunkCount = 0;
    let toolCallCount = 0;
    let totalTokensUsed = 0;

    // Reserved for an explicit, user-initiated stop signal in the
    // future. We deliberately do NOT wire response.close to abort
    // this — that's the whole point of the decoupling.
    const abortController = new AbortController();

    const publish = (chunk: UIMessageChunk): void => {
      chunkCount += 1;
      this.hub.publish(runId, chunk);
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
    let activeReasoningBuffer = '';
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
    publish({ type: 'start' });

    const openText = () => {
      if (activeTextId !== null) return;
      activeTextId = randomUUID();
      activeTextBuffer = '';
      publish({ type: 'text-start', id: activeTextId });
    };

    // Close the current text part on the wire AND persist its content
    // as an `assistant` row. Called at every tool-call boundary and at
    // end-of-turn — no-op if no text is currently open.
    const closeTextSegment = async () => {
      if (activeTextId === null) return;
      publish({ type: 'text-end', id: activeTextId });
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
      activeReasoningBuffer = '';
      publish({ type: 'reasoning-start', id });
    };

    // Close the current reasoning part on the wire AND persist its
    // accumulated text as its own assistant row so reload reproduces
    // the same `<Reasoning>` collapsible the user saw live. The row
    // carries an empty `content` and the buffered chain-of-thought in
    // `reasoning`; the frontend's `toUiMessages` rehydrator emits a
    // `{ type: "reasoning", text, state: "done" }` UIMessage part for
    // any row with non-empty `reasoning`.
    //
    // Called at every tool-call boundary, every reasoning→answer flip,
    // and at end-of-turn. No-op if no reasoning is currently open.
    const closeReasoning = async () => {
      if (activeReasoningId === null) return;
      publish({ type: 'reasoning-end', id: activeReasoningId });
      const buffered = activeReasoningBuffer;
      activeReasoningId = null;
      activeReasoningBuffer = '';
      if (buffered.trim().length === 0) return;
      try {
        await this.messages.insertMessage({
          threadId,
          runId,
          userId,
          role: 'assistant',
          content: '',
          reasoning: buffered,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to persist reasoning segment for run ${runId}: ${String(err)}`,
        );
      }
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
      await closeReasoning();
      publish({
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
        abortController.signal,
      )) {
        if (event.mode === 'messages') {
          // Tuple of [chunk, metadata] from streamMode=messages.
          const tuple = event.payload as [AIMessageChunk | unknown, unknown];
          const chunk = tuple[0];
          if (chunk instanceof AIMessageChunk) {
            const chunkId = (chunk as { id?: string }).id;
            if (chunkId) streamedAiMessageIds.add(chunkId);

            // Accumulate token usage from the LLM provider. The
            // `usage_metadata` is typically populated on the final
            // chunk of each model invocation.
            const um = (
              chunk as {
                usage_metadata?: {
                  input_tokens?: number;
                  output_tokens?: number;
                  total_tokens?: number;
                };
              }
            ).usage_metadata;
            if (um) {
              totalTokensUsed +=
                um.total_tokens ??
                (um.input_tokens ?? 0) + (um.output_tokens ?? 0);
            }

            const reasoningDelta = extractReasoningDelta(chunk);
            if (reasoningDelta) {
              const rid = chunkId ?? `reasoning-${runId}`;
              streamedReasoningIds.add(rid);
              openReasoning(rid);
              if (activeReasoningId) {
                activeReasoningBuffer += reasoningDelta;
                publish({
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
              await closeReasoning();
              openText();
              activeTextBuffer += delta;
              if (activeTextId) {
                publish({
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
                  typeof ai.additional_kwargs?.reasoning_content === 'string'
                    ? ai.additional_kwargs.reasoning_content
                    : '';
                if (reasoning && (!ai.id || !streamedReasoningIds.has(ai.id))) {
                  const rid = ai.id ?? `reasoning-${randomUUID()}`;
                  openReasoning(rid);
                  if (activeReasoningId) {
                    activeReasoningBuffer += reasoning;
                    publish({
                      type: 'reasoning-delta',
                      id: activeReasoningId,
                      delta: reasoning,
                    });
                  }
                  await closeReasoning();
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
                    publish({
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
                publish({
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
      await closeReasoning();
      if (isAbortError(err)) {
        // Reserved for an explicit, future stop endpoint. Currently
        // nothing aborts `abortController` — page reload is handled
        // by letting the run continue and resuming via the hub.
        await this.agentRuns.cancelRun(runId, 'Run was cancelled.');
        publish({ type: 'finish' });
        this.hub.close(runId, 'cancelled');
        this.logger.log(
          `run=${runId} thread=${threadId} cancelled after ` +
            `${Date.now() - startedAt}ms chunks=${chunkCount} ` +
            `tools=${toolCallCount}`,
        );
        return;
      }
      await this.agentRuns.failRun(runId, errorMessage(err));
      publish({ type: 'finish' });
      this.hub.close(runId, 'failed', errorMessage(err));
      this.logger.error(
        `run=${runId} thread=${threadId} failed after ` +
          `${Date.now() - startedAt}ms chunks=${chunkCount} ` +
          `tools=${toolCallCount}: ${errorMessage(err)}`,
      );
      return;
    }

    // Flush the trailing text / reasoning segments (the model's
    // final answer).
    await closeTextSegment();
    await closeReasoning();
    await this.agentRuns.completeRun(runId);

    // Record token usage for quota enforcement. Fire-and-forget so
    // a failed write doesn't block the stream close.
    if (totalTokensUsed > 0) {
      void this.usage
        .recordUsage({
          userId,
          runId,
          threadId,
          tokensUsed: totalTokensUsed,
        })
        .catch((err) => {
          this.logger.warn(
            `Failed to record usage for run ${runId}: ${String(err)}`,
          );
        });
    }

    publish({ type: 'finish' });
    this.hub.close(runId, 'completed');
    this.logger.log(
      `run=${runId} thread=${threadId} completed in ` +
        `${Date.now() - startedAt}ms chunks=${chunkCount} ` +
        `tools=${toolCallCount} tokens=${totalTokensUsed}`,
    );
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
  // Surface reasoning to the wire only when it's actually populated —
  // the field is empty for the vast majority of rows (non-assistant,
  // and assistant turns where the model didn't emit chain-of-thought).
  if (message.reasoning && message.reasoning.length > 0) {
    base.reasoning = message.reasoning;
  }

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
