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

  // Track the live resume controller so we can cancel cleanly when the
  // thread changes / the component unmounts; otherwise a slow reload
  // might leak a half-open EventSource into the next thread.
  const resumeAbortRef = useRef<AbortController | null>(null);

  // Stable transport across renders — `useChat` re-instantiates heavy
  // state when it sees a different transport reference.
  const transport = useMemo(
    () => new DefaultChatTransport<UIMessage>({ api }),
    [api],
  );

  const chat = useAiChat<UIMessage>({
    id: threadId,
    transport,
    onError: (err) => {
      console.error("[useLemmaChat] stream error:", err);
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

  // Fetch the latest page of history once on mount / threadId change,
  // then check whether a previous turn is still streaming and reconnect
  // to its live wire format if so.
  useEffect(() => {
    let cancelled = false;
    setIsInitialized(false);
    setHistoryError(null);
    setIsResuming(false);

    const previousAbort = resumeAbortRef.current;
    if (previousAbort) {
      previousAbort.abort();
      resumeAbortRef.current = null;
    }

    (async () => {
      let history: PersistedMessage[] = [];
      try {
        const res = await fetch(historyApi(threadId), {
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
        history = [...page.messages].reverse();
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

      // History is in place. Decide whether to reconnect to a still-
      // running turn — best-effort: any failure here must never break
      // the seeded history.
      if (cancelled) return;
      try {
        const activeRunRes = await fetch(activeRunApi(threadId), {
          credentials: "include",
        });
        if (!activeRunRes.ok) return;
        const active = (await activeRunRes.json()) as ActiveRun | null;
        if (!active || active.status !== "running" || !active.runId) return;
        if (cancelled) return;

        // Find the user message that started this run so we can splice
        // off any partial assistant turn already persisted and rebuild
        // it from the resume stream. Without this we'd append the
        // replayed deltas on top of the partial reload state and
        // double up every word.
        const splice = computeResumeSplice(history, active.runId);
        if (splice === null) return;

        await resumeFromHub({
          runId: active.runId,
          spliceCount: splice,
          history,
          resumeApi,
          setMessages,
          setIsResuming,
          abortRef: resumeAbortRef,
          isCancelled: () => cancelled,
        });
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
  }, [threadId]);

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
    status === "submitted" || status === "streaming" || isResuming;
  const isStreaming = status === "streaming" || isResuming;

  return {
    messages,
    status,
    isLoading,
    isStreaming,
    error: error?.message ?? historyError,
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

/**
 * Subscribe to the in-memory hub via `/api/chat/stream/resume`, parse
 * the SSE-framed Vercel AI SDK UI message stream, and rebuild the
 * partial assistant turn in place. Mutates the messages array exactly
 * once per chunk via `setMessages` so React re-renders on every delta.
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
  setIsResuming: (v: boolean) => void;
  abortRef: MutableRefObject<AbortController | null>;
  isCancelled: () => boolean;
}): Promise<void> {
  const {
    runId,
    spliceCount,
    history,
    resumeApi,
    setMessages,
    setIsResuming,
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

  setIsResuming(true);

  let response: Response;
  try {
    response = await fetch(resumeApi(runId), {
      credentials: "include",
      signal: ac.signal,
    });
  } catch {
    setIsResuming(false);
    return;
  }

  if (!response.ok || !response.body) {
    setIsResuming(false);
    return;
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

  try {
    for await (const chunk of parseUiMessageStream(response.body, ac.signal)) {
      applyResumeChunk(accumulator, chunk);
      flush();
      if (chunk.type === "finish") break;
    }
  } catch {
    // Abort or network error — leave whatever the accumulator built so
    // far on screen. The next mount-time history fetch will reconcile
    // anything that finished on the backend after the connection died.
  } finally {
    setIsResuming(false);
    if (abortRef.current === ac) abortRef.current = null;
  }
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
