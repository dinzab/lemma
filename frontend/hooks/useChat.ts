"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";

interface UseLemmaChatOptions {
  threadId: string;
  /**
   * Endpoint for the Vercel AI SDK data-stream proxy. Defaults to the
   * Next.js API route which forwards to NestJS with a Supabase bearer
   * token.
   */
  api?: string;
  /**
   * Newest-first paginated history endpoint. Defaults to the matching
   * proxy. We fetch the latest page once at mount to seed `useChat`'s
   * messages array.
   */
  historyApi?: (threadId: string) => string;
  /**
   * Active-run lookup endpoint. Returns `{ runId, status }` for the most
   * recent run on the thread; the hook re-attaches to a still-`running`
   * run via {@link resumeApi}. Defaults to the Next.js proxy.
   */
  activeRunApi?: (threadId: string) => string;
  /**
   * Live-resume endpoint URL builder. Reads the in-memory `RunStreamHub`
   * channel for the given `runId` and returns the same Vercel AI SDK UI
   * message stream the original `POST /chat/stream` produced.
   */
  resumeApi?: (runId: string) => string;
  /**
   * How many of the most recent messages to seed the chat with.
   * Defaults to 50; older history can be loaded on demand via
   * `loadOlder`.
   */
  initialLimit?: number;
}

type ActiveRunStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

interface ActiveRun {
  runId: string | null;
  status: ActiveRunStatus;
}

interface PersistedMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  /**
   * Run id this message belongs to. Tool-role rows are rehydrated
   * onto the assistant turn that owns them by matching `runId`.
   */
  runId?: string | null;
  toolCallId?: string;
  toolName?: string;
  /** Tool call arguments — present on `role: 'tool'` rows. */
  toolInput?: unknown;
  /** Tool call return value — present on `role: 'tool'` rows. */
  toolOutput?: unknown;
  createdAt?: string;
}

interface MessagesPage {
  messages: PersistedMessage[];
  nextCursor: string | null;
  total: number;
}

/**
 * Lemma chat hook — wraps the Vercel AI SDK `useChat` for streaming live
 * turns and pairs it with a paginated history fetch against the NestJS
 * `/threads/:id/messages` endpoint.
 *
 * After seeding history we additionally call `/threads/:id/active-run`.
 * If the response says a run is still `running` we re-attach to it via
 * `/chat/stream/resume?runId=…` so the user picks up the live stream
 * after a page reload or transient WiFi drop — no re-prompt required,
 * no lost tokens. When the run is no longer in the in-memory hub
 * (server restart, eviction TTL elapsed) the resume endpoint returns
 * an empty `start … finish` envelope and the hook falls back to
 * whatever the persisted history already contains.
 *
 * Returns the SDK's native `UIMessage[]` shape so callers can render with
 * the AI Elements components (`<Conversation />`, `<Message />`, `<Tool />`,
 * `<MessageResponse />`) without further conversion. Tool calls are
 * already encoded as `dynamic-tool` parts on the wire by the NestJS
 * stream — see `chat.service.ts`.
 */
export function useLemmaChat({
  threadId,
  api = "/api/chat/stream",
  historyApi = (id) => `/api/threads/${id}/messages?limit=50`,
  activeRunApi = (id) => `/api/threads/${id}/active-run`,
  resumeApi = (runId) =>
    `/api/chat/stream/resume?runId=${encodeURIComponent(runId)}`,
  initialLimit = 50,
}: UseLemmaChatOptions) {
  const [seededAt, setSeededAt] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [olderTotal, setOlderTotal] = useState(0);
  const [isResuming, setIsResuming] = useState(false);
  // True while the resume loop is in between attempts (backoff sleep)
  // OR actively reconnecting after a dropped stream. Distinct from
  // `isResuming` (true on the very first attach) so the UI can show a
  // “Reconnecting…” indicator only when we're actually retrying.
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Track the live resume controller so we can cancel cleanly when the
  // thread changes / the component unmounts; otherwise a slow reload
  // might leak a half-open EventSource into the next thread.
  const resumeAbortRef = useRef<AbortController | null>(null);
  // Guard against re-entrancy when the SDK's `onError` fires multiple
  // times for the same drop — only one reconnect loop should ever be
  // running per thread mount.
  const reconnectInFlightRef = useRef(false);
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  // The default `activeRunApi` / `historyApi` / `resumeApi` props are
  // arrow-lambdas re-created every render, so listing them in a
  // `useCallback` dep array would invalidate the reconnect loop on
  // every render and tear down the seed effect with it. We pin them
  // to refs so closures stay stable while still picking up overrides
  // if a caller swaps them.
  const activeRunApiRef = useRef(activeRunApi);
  activeRunApiRef.current = activeRunApi;
  const historyApiRef = useRef(historyApi);
  historyApiRef.current = historyApi;
  const resumeApiRef = useRef(resumeApi);
  resumeApiRef.current = resumeApi;

  // Stable transport across renders — `useChat` re-instantiates heavy
  // state when it sees a different transport reference.
  const transport = useMemo(
    () => new DefaultChatTransport<UIMessage>({ api }),
    [api],
  );

  // Forward declared so `onError` can fire it without a circular ref.
  // The actual implementation is set below once `setMessages` etc. are
  // available; we route through a ref so the SDK callback stays stable.
  const triggerAutoReconnectRef = useRef<() => void>(() => {});

  const chat = useAiChat<UIMessage>({
    id: threadId,
    transport,
    onError: (err) => {
      console.error("[useLemmaChat] stream error:", err);
      // The live POST /chat/stream connection just dropped. The agent
      // run keeps going on the backend (see chat.service.ts — close on
      // the HTTP response is intentionally NOT wired to abort), so we
      // can fall back to the resume hub and replay whatever we missed.
      triggerAutoReconnectRef.current();
    },
  });

  const {
    messages: aiMessages,
    setMessages,
    sendMessage,
    stop,
    regenerate,
    status,
    error,
  } = chat;

  // Reusable reconnect entry point. Re-fetches history (so the splice
  // prefix is up-to-date when we're called mid-flight after a live
  // stream drop), looks up the active run, and replays the hub with
  // exponential backoff until the run reports a terminal status, the
  // wire emits a `finish` chunk, or we hit MAX_RECONNECT_ATTEMPTS.
  //
  // `isCancelled` is checked between attempts and inside the backoff
  // sleep so a thread switch / unmount tears down the loop promptly.
  const runReconnectLoop = useCallback(
    async (isCancelled: () => boolean): Promise<void> => {
      if (reconnectInFlightRef.current) return;
      reconnectInFlightRef.current = true;
      const tid = threadIdRef.current;
      try {
        for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
          if (isCancelled()) return;

          // Re-probe active-run on every attempt so a run that finishes
          // server-side between retries can short-circuit the loop.
          let active: ActiveRun | null = null;
          try {
            const res = await fetch(activeRunApiRef.current(tid), {
              credentials: "include",
            });
            if (res.ok) {
              active = (await res.json()) as ActiveRun;
            }
          } catch {
            // Network error on the probe — fall through to backoff;
            // the next attempt may succeed.
          }
          if (
            !active ||
            active.status !== "running" ||
            !active.runId
          ) {
            // Run is no longer alive (completed / failed / cancelled /
            // never existed). Nothing left to do; the persisted
            // history is already accurate via the seed fetch.
            return;
          }

          // Re-fetch history so the splice prefix reflects whatever the
          // backend persisted while we were disconnected.
          let history: PersistedMessage[];
          try {
            const res = await fetch(historyApiRef.current(tid), {
              credentials: "include",
            });
            if (!res.ok) throw new Error(`history ${res.status}`);
            const page = (await res.json()) as MessagesPage;
            history = [...page.messages].reverse();
          } catch {
            history = [];
          }
          const splice = computeResumeSplice(history, active.runId);
          if (splice === null) return;
          if (isCancelled()) return;

          // First attempt is plain “resuming” (the user just opened the
          // page or the stream just dropped); follow-up attempts after
          // a dropped wire show as “Reconnecting…”.
          if (attempt === 0) {
            setIsResuming(true);
          } else {
            setIsReconnecting(true);
          }

          const outcome = await resumeFromHub({
            runId: active.runId,
            spliceCount: splice,
            history,
            resumeApi: resumeApiRef.current,
            setMessages,
            abortRef: resumeAbortRef,
            isCancelled,
          });

          if (outcome === "finish" || outcome === "cancelled") {
            return;
          }

          // Stream dropped without a `finish` chunk. Back off, then
          // re-probe + re-attach. The hub re-replays from the start of
          // the run on every subscriber, so the next attempt rebuilds
          // the assistant turn from scratch — no double-counting.
          setIsReconnecting(true);
          const delay = backoffDelayMs(attempt);
          const slept = await sleepCancellable(delay, isCancelled);
          if (!slept) return;
        }
      } finally {
        reconnectInFlightRef.current = false;
        setIsResuming(false);
        setIsReconnecting(false);
      }
    },
    // `setMessages` is stable per useAiChat instance; the API builders
    // are pinned via refs above so they don't need to be deps.
    [setMessages],
  );

  // Stable wrapper for the SDK's `onError` callback. Cancels any
  // in-flight resume connection (so we don't fight ourselves), then
  // kicks off a fresh reconnect loop tied to the current mount.
  useEffect(() => {
    let cancelled = false;
    triggerAutoReconnectRef.current = () => {
      const ac = resumeAbortRef.current;
      if (ac) {
        ac.abort();
        resumeAbortRef.current = null;
      }
      void runReconnectLoop(() => cancelled);
    };
    return () => {
      cancelled = true;
      triggerAutoReconnectRef.current = () => {};
    };
  }, [runReconnectLoop]);

  // Fetch the latest page of history once on mount / threadId change,
  // then check whether a previous turn is still streaming and reconnect
  // to its live wire format if so.
  useEffect(() => {
    let cancelled = false;
    setIsInitialized(false);
    setHistoryError(null);
    setIsResuming(false);
    setIsReconnecting(false);

    const previousAbort = resumeAbortRef.current;
    if (previousAbort) {
      previousAbort.abort();
      resumeAbortRef.current = null;
    }

    (async () => {
      try {
        const res = await fetch(historyApiRef.current(threadId), {
          credentials: "include",
        });
        if (!res.ok) {
          if (cancelled) return;
          setMessages([]);
          setSeededAt(threadId);
          setIsInitialized(true);
          return;
        }
        const page = (await res.json()) as MessagesPage;
        if (cancelled) return;
        // Backend returns newest-first (cursor-paginated); the UI needs
        // chronological order (oldest at top, newest at bottom) so the
        // sticky-to-bottom transcript reads naturally.
        const history = [...page.messages].reverse();
        setMessages(toUiMessages(history));
        setSeededAt(threadId);
        setOlderCursor(page.nextCursor);
        setOlderTotal(page.total ?? page.messages.length);
        setIsInitialized(true);
      } catch (err) {
        if (cancelled) return;
        setHistoryError(
          err instanceof Error ? err.message : "Failed to load history",
        );
        setIsInitialized(true);
        return;
      }

      // History is in place. Best-effort: any failure inside the
      // reconnect loop must never break the seeded history.
      if (cancelled) return;
      try {
        await runReconnectLoop(() => cancelled);
      } catch (err) {
        console.warn("[useLemmaChat] resume skipped:", err);
      }
    })();

    return () => {
      cancelled = true;
      const ac = resumeAbortRef.current;
      if (ac) {
        ac.abort();
        resumeAbortRef.current = null;
      }
    };
    // historyApi/setMessages intentionally omitted — historyApi is a
    // closure over threadId, and setMessages is stable per useChat
    // instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, runReconnectLoop]);

  const messages: UIMessage[] = useMemo(
    () => (seededAt ? aiMessages : []),
    [aiMessages, seededAt],
  );

  const sendText = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      return sendMessage({ text });
    },
    [sendMessage],
  );

  const stopGeneration = useCallback(() => {
    // Hard stop: cancel resume + reconnect entirely so we don't quietly
    // restart the loop the moment the user clicks Stop.
    reconnectInFlightRef.current = false;
    setIsReconnecting(false);
    setIsResuming(false);
    const ac = resumeAbortRef.current;
    if (ac) {
      ac.abort();
      resumeAbortRef.current = null;
    }
    stop();
  }, [stop]);

  const regenerateLastMessage = useCallback(() => regenerate(), [regenerate]);

  const loadOlder = useCallback(async () => {
    if (!olderCursor) return;
    const base = historyApi(threadId).replace(/[?&]before=[^&]*/g, "");
    const url =
      base +
      (base.includes("?") ? "&" : "?") +
      `before=${encodeURIComponent(olderCursor)}`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return;
    const page = (await res.json()) as MessagesPage;
    // Newest-first → reverse to chronological so it can be prepended
    // above the existing transcript without breaking ordering.
    setMessages((prev) => [
      ...toUiMessages([...page.messages].reverse()),
      ...prev,
    ]);
    setOlderCursor(page.nextCursor);
  }, [historyApi, olderCursor, setMessages, threadId]);

  const isLoading =
    status === "submitted" ||
    status === "streaming" ||
    isResuming ||
    isReconnecting;
  const isStreaming =
    status === "streaming" || isResuming || isReconnecting;

  return {
    messages,
    status,
    isLoading,
    isStreaming,
    isReconnecting,
    // The live wire is errored only if the SDK reports an error AND we
    // are NOT in the middle of an auto-reconnect attempt; otherwise the
    // user would see a flash of red error UI between drop and retry.
    error:
      isReconnecting || isResuming ? historyError : error?.message ?? historyError,
    isInitialized,
    threadId,
    sendMessage: sendText,
    stopGeneration,
    regenerateLastMessage,
    loadOlder,
    hasOlder: !!olderCursor,
    total: Math.max(olderTotal, messages.length),
    initialLimit,
  };
}

// Auto-reconnect tuning. Six attempts at 250 ms / 500 ms / 1 s / 2 s /
// 4 s / 4 s covers ≈12 s of dropouts — long enough for a typical
// WiFi handover, short enough that a permanently dead run doesn't keep
// a zombie indicator on screen forever.
const MAX_RECONNECT_ATTEMPTS = 6;
const RECONNECT_BACKOFFS_MS = [250, 500, 1000, 2000, 4000, 4000];

function backoffDelayMs(attemptIndex: number): number {
  const i = Math.min(attemptIndex, RECONNECT_BACKOFFS_MS.length - 1);
  return RECONNECT_BACKOFFS_MS[i];
}

/**
 * `setTimeout` wrapped in a polled cancel check. Returns `true` if it
 * slept the full duration, `false` if `isCancelled()` flipped during
 * the wait — callers can short-circuit on `false`.
 */
function sleepCancellable(
  ms: number,
  isCancelled: () => boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (isCancelled()) {
        resolve(false);
        return;
      }
      const remaining = ms - (Date.now() - start);
      if (remaining <= 0) {
        resolve(true);
        return;
      }
      setTimeout(tick, Math.min(remaining, 100));
    };
    tick();
  });
}

// ---------- conversion helpers ----------

function toUiMessages(persisted: PersistedMessage[]): UIMessage[] {
  // Walk persisted rows in chronological order (the input is already in
  // sequence-ascending order). Each user row becomes its own UIMessage;
  // every consecutive non-user row that shares the same `runId` is folded
  // into a single assistant UIMessage whose `parts` array preserves the
  // exact text/tool/text/tool/text interleaving the user saw live.
  //
  // The backend persists each text segment between two tool-call
  // boundaries as its own `role: 'assistant'` row, so reload reproduces
  // the streaming order without any extra metadata.
  const out: UIMessage[] = [];
  let i = 0;
  while (i < persisted.length) {
    const m = persisted[i];
    if (m.role === "system") {
      i++;
      continue;
    }
    if (m.role === "user") {
      out.push({
        id: m.id,
        role: "user",
        parts: m.content
          ? [{ type: "text", text: m.content, state: "done" }]
          : [],
      } as UIMessage);
      i++;
      continue;
    }

    // assistant or tool row — start an assistant turn and gather every
    // following row that shares this run id (or both lack a runId).
    const runKey = m.runId ?? null;
    const turnRows: PersistedMessage[] = [];
    while (i < persisted.length) {
      const r = persisted[i];
      if (r.role === "user") break;
      if (r.role === "system") {
        i++;
        continue;
      }
      const sameRun = (r.runId ?? null) === runKey;
      if (!sameRun) break;
      turnRows.push(r);
      i++;
    }
    if (turnRows.length === 0) continue;

    const parts: UIMessage["parts"] = [];
    for (const r of turnRows) {
      if (r.role === "tool") {
        if (!r.toolName || !r.toolCallId) continue;
        // Legacy rows from before the dual-write split only populated
        // `content` (the stringified tool result) and left `toolInput`
        // / `toolOutput` null. Fall back to the content column so old
        // threads still render their tool outputs instead of looking
        // like the tool never returned.
        const output =
          r.toolOutput ?? (r.content ? safeParse(r.content) : undefined);
        const hasOutput = output !== undefined && output !== null;
        parts.push({
          type: "dynamic-tool",
          toolName: r.toolName,
          toolCallId: r.toolCallId,
          state: hasOutput ? "output-available" : "input-available",
          input: (r.toolInput ?? {}) as Record<string, unknown>,
          ...(hasOutput ? { output } : {}),
        } as UIMessage["parts"][number]);
      } else if (r.role === "assistant" && r.content) {
        parts.push({ type: "text", text: r.content, state: "done" });
      }
    }

    out.push({
      id: turnRows[0].id,
      role: "assistant",
      parts,
    } as UIMessage);
  }
  return out;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ---------- resume helpers ----------

/**
 * Walk the chronological persisted history looking for the user message
 * that opens the run `runId`. Returns the count of rows up to and
 * including that user message — i.e. the prefix to keep when splicing
 * off the partial assistant turn before replaying the resume stream.
 *
 * Returns `null` when no row claims the run id (stale active-run record
 * or a crash before the user message was persisted).
 */
function computeResumeSplice(
  history: PersistedMessage[],
  runId: string,
): number | null {
  for (let i = 0; i < history.length; i++) {
    const row = history[i];
    if (row.role === "user" && row.runId === runId) {
      return i + 1;
    }
  }
  return null;
}

/** UIMessage state we mutate as resume chunks stream in. */
type AssistantAccumulator = {
  id: string;
  parts: Array<Record<string, unknown>>;
  textPartIndex: Map<string, number>;
  reasoningPartIndex: Map<string, number>;
  toolPartIndex: Map<string, number>;
};

function newAccumulator(id: string): AssistantAccumulator {
  return {
    id,
    parts: [],
    textPartIndex: new Map(),
    reasoningPartIndex: new Map(),
    toolPartIndex: new Map(),
  };
}

interface ResumeChunk {
  type: string;
  id?: string;
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
}

/** Outcome of a single resume attempt, used by the reconnect loop. */
type ResumeOutcome = "finish" | "dropped" | "failed" | "cancelled";

/**
 * Subscribe to the in-memory hub via `/api/chat/stream/resume`, parse
 * the SSE-framed Vercel AI SDK UI message stream, and rebuild the
 * partial assistant turn in place. Mutates the messages array exactly
 * once per chunk via `setMessages` so React re-renders on every delta.
 *
 * Returns one of:
 *  - `"finish"`    – stream emitted its terminal `finish` chunk
 *  - `"dropped"`   – stream ended without `finish` (network drop or
 *                    server hub closed mid-flight) — caller should
 *                    consider reconnecting if the run is still alive
 *  - `"failed"`    – fetch errored or returned non-2xx; same as
 *                    `dropped` from a retry-policy standpoint
 *  - `"cancelled"` – the abort signal flipped (thread switch / unmount
 *                    / user pressed Stop); caller should NOT retry
 *
 * The first `setMessages` call splices off any partial assistant turn
 * the history fetch returned (we kept it on screen long enough to
 * avoid a flash; the resume stream is the source of truth from the
 * user message forward).
 */
async function resumeFromHub(args: {
  runId: string;
  spliceCount: number;
  history: PersistedMessage[];
  resumeApi: (runId: string) => string;
  setMessages: (
    next: UIMessage[] | ((prev: UIMessage[]) => UIMessage[]),
  ) => void;
  abortRef: MutableRefObject<AbortController | null>;
  isCancelled: () => boolean;
}): Promise<ResumeOutcome> {
  const {
    runId,
    spliceCount,
    history,
    resumeApi,
    setMessages,
    abortRef,
    isCancelled,
  } = args;

  const ac = new AbortController();
  abortRef.current = ac;

  // Drop the partial assistant turn (if any) so resume rebuilds from
  // the user message forward. The first `spliceCount` history rows are
  // everything up to and including the user message that started the
  // run.
  const seedRows = history.slice(0, spliceCount);
  const seedMessages = toUiMessages(seedRows);
  setMessages(seedMessages);

  let response: Response;
  try {
    response = await fetch(resumeApi(runId), {
      credentials: "include",
      signal: ac.signal,
    });
  } catch {
    if (abortRef.current === ac) abortRef.current = null;
    return isCancelled() ? "cancelled" : "failed";
  }

  if (!response.ok || !response.body) {
    if (abortRef.current === ac) abortRef.current = null;
    return isCancelled() ? "cancelled" : "failed";
  }

  const accumulator = newAccumulator(`resume-${runId}`);

  const flush = () => {
    if (isCancelled()) return;
    setMessages([
      ...seedMessages,
      {
        id: accumulator.id,
        role: "assistant",
        parts: accumulator.parts as UIMessage["parts"],
      } as UIMessage,
    ]);
  };

  let sawFinish = false;
  try {
    for await (const chunk of parseUiMessageStream(response.body, ac.signal)) {
      applyResumeChunk(accumulator, chunk);
      flush();
      if (chunk.type === "finish") {
        sawFinish = true;
        break;
      }
    }
  } catch {
    // Abort or network error — leave whatever the accumulator built so
    // far on screen. The reconnect loop will decide whether to retry.
  } finally {
    if (abortRef.current === ac) abortRef.current = null;
  }

  if (isCancelled()) return "cancelled";
  return sawFinish ? "finish" : "dropped";
}

function applyResumeChunk(
  acc: AssistantAccumulator,
  chunk: ResumeChunk,
): void {
  switch (chunk.type) {
    case "text-start": {
      if (!chunk.id) return;
      const idx = acc.parts.length;
      acc.parts.push({ type: "text", text: "", state: "streaming" });
      acc.textPartIndex.set(chunk.id, idx);
      return;
    }
    case "text-delta": {
      if (!chunk.id || typeof chunk.delta !== "string") return;
      const idx = acc.textPartIndex.get(chunk.id);
      if (idx === undefined) return;
      const part = acc.parts[idx] as { text?: string };
      part.text = (part.text ?? "") + chunk.delta;
      return;
    }
    case "text-end": {
      if (!chunk.id) return;
      const idx = acc.textPartIndex.get(chunk.id);
      if (idx === undefined) return;
      (acc.parts[idx] as { state: string }).state = "done";
      return;
    }
    case "reasoning-start": {
      if (!chunk.id) return;
      const idx = acc.parts.length;
      acc.parts.push({ type: "reasoning", text: "", state: "streaming" });
      acc.reasoningPartIndex.set(chunk.id, idx);
      return;
    }
    case "reasoning-delta": {
      if (!chunk.id || typeof chunk.delta !== "string") return;
      const idx = acc.reasoningPartIndex.get(chunk.id);
      if (idx === undefined) return;
      const part = acc.parts[idx] as { text?: string };
      part.text = (part.text ?? "") + chunk.delta;
      return;
    }
    case "reasoning-end": {
      if (!chunk.id) return;
      const idx = acc.reasoningPartIndex.get(chunk.id);
      if (idx === undefined) return;
      (acc.parts[idx] as { state: string }).state = "done";
      return;
    }
    case "tool-input-available": {
      if (!chunk.toolCallId || !chunk.toolName) return;
      const idx = acc.parts.length;
      acc.parts.push({
        type: "dynamic-tool",
        toolName: chunk.toolName,
        toolCallId: chunk.toolCallId,
        state: "input-available",
        input: (chunk.input ?? {}) as Record<string, unknown>,
      });
      acc.toolPartIndex.set(chunk.toolCallId, idx);
      return;
    }
    case "tool-output-available": {
      if (!chunk.toolCallId) return;
      const idx = acc.toolPartIndex.get(chunk.toolCallId);
      if (idx === undefined) return;
      const part = acc.parts[idx] as Record<string, unknown>;
      part.state = "output-available";
      part.output = chunk.output;
      return;
    }
    default:
      return;
  }
}

/**
 * Parse a Server-Sent Events body into a stream of decoded UI message
 * chunks. Each SSE frame is `data: <json>\n\n` (Vercel AI SDK format),
 * potentially with multiple frames per network read.
 */
async function* parseUiMessageStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<ResumeChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line. Tolerate \n\n and
      // \r\n\r\n since either may show up depending on the proxy chain.
      let idx = findFrameBoundary(buffer);
      while (idx !== null) {
        const frame = buffer.slice(0, idx.start);
        buffer = buffer.slice(idx.end);
        const data = extractData(frame);
        if (data) {
          try {
            yield JSON.parse(data) as ResumeChunk;
          } catch {
            // Ignore malformed frames — the backend is the source
            // of truth; a corrupt chunk shouldn't tear down resume.
          }
        }
        idx = findFrameBoundary(buffer);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

function findFrameBoundary(
  s: string,
): { start: number; end: number } | null {
  const a = s.indexOf("\n\n");
  const b = s.indexOf("\r\n\r\n");
  if (a === -1 && b === -1) return null;
  if (a === -1) return { start: b, end: b + 4 };
  if (b === -1) return { start: a, end: a + 2 };
  return a < b ? { start: a, end: a + 2 } : { start: b, end: b + 4 };
}

function extractData(frame: string): string {
  const lines = frame.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      // SSE strips one leading space if present.
      const v = line.slice(5);
      dataLines.push(v.startsWith(" ") ? v.slice(1) : v);
    }
  }
  return dataLines.join("\n");
}
