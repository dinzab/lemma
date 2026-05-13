/**
 * NIM thinking-mode `reasoning_content` echo relay.
 *
 * ## Why this exists
 *
 * NVIDIA NIM's reasoning ("thinking") models emit a `reasoning_content`
 * field on every AIMessage they produce, AND require that field to be
 * **echoed back** on subsequent calls when the assistant message appears
 * in conversation history. If the field is missing, NIM responds
 *
 *   400 Param Incorrect — "The reasoning_content in the thinking mode
 *   must be passed back to the API."
 *
 * killing the second hop of every ReAct loop (chat → tool → chat).
 *
 * `@langchain/openai`'s
 * {@link https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-openai/src/utils/openai-format-fndef.ts | converter}
 * (`convertMessagesToCompletionsMessageParams` and its v1 standard-content
 * sibling) only propagate `function_call`, `tool_calls`, `tool_call_id`,
 * and `audio.id` from `additional_kwargs`. `reasoning_content` is captured
 * into `additional_kwargs` on the inbound side but is silently dropped
 * when the same message is serialised back out to the OpenAI request
 * body — so we can't fix this by mutating `AIMessage` alone.
 *
 * ## How the relay works
 *
 *  1. Before invoking the model, the chat node calls {@link collectReasoning}
 *     on `state.messages` to build a per-call map of
 *     `tool_call_id → reasoning_content` (plus an index fallback for
 *     reasoning AIMessages that don't have tool_calls). This map is
 *     stored in an {@link AsyncLocalStorage} so it survives the awaits
 *     LangChain performs internally without leaking across concurrent
 *     chat invocations.
 *
 *  2. The OpenAI client built by {@link LlmService} is wired with a custom
 *     `fetch` that calls {@link injectReasoningIntoRequestBody} on every
 *     outbound request body. The injector parses the JSON body, walks
 *     `body.messages`, and re-attaches `reasoning_content` to each
 *     assistant message whose `tool_calls[].id` (or position) matches
 *     what {@link collectReasoning} captured.
 *
 *  3. If no relay context is active (any non-chat-node code path) the
 *     fetch is a transparent pass-through. The injector is JSON-safe:
 *     a parse failure, a non-object body, or a missing `messages` array
 *     all fall through to the original body so a malformed request can
 *     never blow up because of this hook.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

/**
 * Request-scoped lookup table that the OpenAI fetch hook reads to
 * re-attach `reasoning_content` onto assistant messages just before
 * they hit the wire.
 *
 * `byToolCallId` is the strong key: NIM's reasoning models emit
 * `reasoning_content` on the AIMessage that *also* emits the
 * tool_calls, and that tool_call id is preserved in the outbound
 * request body — so we can correlate exactly without depending on
 * message ordering.
 *
 * `byOutboundIndex` is a fallback for reasoning AIMessages with no
 * tool_calls (e.g. a final-answer turn followed by a user follow-up).
 * It's keyed on the message's position in the outbound `messages`
 * array (system prompt offset already applied — see {@link collectReasoning}).
 */
export interface ReasoningRelayContext {
  byToolCallId: Map<string, string>;
  byOutboundIndex: Map<number, string>;
}

const storage = new AsyncLocalStorage<ReasoningRelayContext>();

/**
 * Build a {@link ReasoningRelayContext} from the chat-node's
 * `state.messages` and run `fn` with that context attached to the
 * async-local store. The context is automatically dropped when `fn`
 * resolves, so two parallel chat invocations cannot clobber each
 * other's reasoning.
 *
 * The {@link OUTBOUND_OFFSET} accounts for the system prompt that
 * `chat.node.ts` prepends to `state.messages` before calling `invoke`.
 * If the caller's outbound layout ever changes (e.g. multiple system
 * messages, prepended developer notes), pass the actual offset
 * explicitly via {@link runWithReasoningRelay}.
 */
export const OUTBOUND_OFFSET = 1;

export function collectReasoning(
  messages: BaseMessage[],
  outboundOffset: number = OUTBOUND_OFFSET,
): ReasoningRelayContext {
  const ctx: ReasoningRelayContext = {
    byToolCallId: new Map(),
    byOutboundIndex: new Map(),
  };
  messages.forEach((m, i) => {
    if (!AIMessage.isInstance(m)) return;
    const ak = (m as { additional_kwargs?: Record<string, unknown> })
      .additional_kwargs;
    const raw = ak?.reasoning_content;
    if (typeof raw !== 'string' || raw.length === 0) return;

    ctx.byOutboundIndex.set(i + outboundOffset, raw);

    // `tool_calls` is the public, typed surface on AIMessage. Some
    // adapters also stash the raw OpenAI tool_calls into
    // additional_kwargs.tool_calls (with an `id` field) — read both
    // so we don't miss correlations on borderline message shapes.
    const aiTc = (m as { tool_calls?: Array<{ id?: string }> }).tool_calls;
    if (Array.isArray(aiTc)) {
      for (const tc of aiTc) {
        if (typeof tc.id === 'string' && tc.id.length > 0) {
          ctx.byToolCallId.set(tc.id, raw);
        }
      }
    }
    const akTc = (ak as { tool_calls?: Array<{ id?: string }> } | undefined)
      ?.tool_calls;
    if (Array.isArray(akTc)) {
      for (const tc of akTc) {
        if (typeof tc.id === 'string' && tc.id.length > 0) {
          ctx.byToolCallId.set(tc.id, raw);
        }
      }
    }
  });
  return ctx;
}

/**
 * Run `fn` with `context` attached to the async-local store. The fetch
 * hook installed on the OpenAI client reads this store on every
 * outbound request body.
 */
export function runWithReasoningRelay<T>(
  context: ReasoningRelayContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

/**
 * Read the current relay context. Returns `undefined` outside of
 * {@link runWithReasoningRelay}.
 */
export function getCurrentReasoningContext():
  | ReasoningRelayContext
  | undefined {
  return storage.getStore();
}

/**
 * The body shape we care about — a Chat Completions request. Everything
 * else is passed through unchanged.
 */
interface AssistantOutboundMessage {
  role?: unknown;
  content?: unknown;
  reasoning_content?: unknown;
  tool_calls?: Array<{ id?: unknown }>;
}
interface OutboundBody {
  messages?: AssistantOutboundMessage[];
}

/**
 * Mutate `body` in place, attaching `reasoning_content` to each
 * assistant message in `body.messages` that has a matching reasoning
 * trace in `context`. Returns the same object for convenience.
 *
 * Order of preference when matching a message:
 *   1. Any `tool_calls[].id` present in `context.byToolCallId`
 *   2. The message's position in `body.messages` via
 *      `context.byOutboundIndex`
 *
 * The injector is intentionally non-throwing: any structural anomaly
 * (missing `messages`, non-array `tool_calls`, etc.) is skipped silently
 * because a 400 from the hook would be strictly worse than a 400 from
 * NIM — at least NIM's error can be debugged.
 */
export function injectReasoningIntoRequestBody(
  body: OutboundBody,
  context: ReasoningRelayContext,
): OutboundBody {
  if (!body || typeof body !== 'object') return body;
  const msgs = body.messages;
  if (!Array.isArray(msgs)) return body;

  msgs.forEach((msg, idx) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.role !== 'assistant') return;
    // Don't clobber a reasoning_content that an upstream layer already
    // set (defensive — shouldn't happen with stock LangChain, but a
    // future converter version may begin propagating it natively).
    if (typeof msg.reasoning_content === 'string' && msg.reasoning_content)
      return;

    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const id = tc?.id;
        if (typeof id === 'string') {
          const r = context.byToolCallId.get(id);
          if (r) {
            msg.reasoning_content = r;
            return;
          }
        }
      }
    }

    const r = context.byOutboundIndex.get(idx);
    if (r) msg.reasoning_content = r;
  });

  return body;
}

/**
 * Build a `fetch` wrapper that re-attaches `reasoning_content` to
 * assistant messages on every outbound Chat Completions request whose
 * body is a JSON string. Other content types (multipart uploads,
 * streamed bodies, etc.) and requests made outside
 * {@link runWithReasoningRelay} pass through unchanged.
 *
 * The wrapper is installed on the {@link ChatOpenAI} via
 * `configuration.fetch`. It is intentionally not coupled to any
 * specific endpoint — the body inspection itself decides whether
 * there's anything to inject.
 */
export type FetchLike = typeof globalThis.fetch;

export function makeReasoningInjectingFetch(
  base: FetchLike = globalThis.fetch,
): FetchLike {
  return async (input, init) => {
    const ctx = storage.getStore();
    if (!ctx || !init || typeof init !== 'object') {
      return base(input as Parameters<FetchLike>[0], init);
    }
    const body = (init as { body?: unknown }).body;
    if (typeof body !== 'string') {
      return base(input as Parameters<FetchLike>[0], init);
    }
    let parsed: OutboundBody | undefined;
    try {
      parsed = JSON.parse(body) as OutboundBody;
    } catch {
      return base(input as Parameters<FetchLike>[0], init);
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.messages)
    ) {
      return base(input as Parameters<FetchLike>[0], init);
    }
    injectReasoningIntoRequestBody(parsed, ctx);
    let restringified: string;
    try {
      restringified = JSON.stringify(parsed);
    } catch {
      return base(input as Parameters<FetchLike>[0], init);
    }
    const nextInit = { ...init, body: restringified };
    return base(input as Parameters<FetchLike>[0], nextInit);
  };
}
