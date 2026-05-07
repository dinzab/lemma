"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
   * How many of the most recent messages to seed the chat with.
   * Defaults to 50; older history can be loaded on demand via
   * `loadOlder`.
   */
  initialLimit?: number;
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
  initialLimit = 50,
}: UseLemmaChatOptions) {
  const [seededAt, setSeededAt] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [olderTotal, setOlderTotal] = useState(0);

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

  // Fetch the latest page of history once on mount / threadId change.
  useEffect(() => {
    let cancelled = false;
    setIsInitialized(false);
    setHistoryError(null);

    (async () => {
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
        setMessages(toUiMessages([...page.messages].reverse()));
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
      }
    })();

    return () => {
      cancelled = true;
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

  const stopGeneration = useCallback(() => stop(), [stop]);

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

  const isLoading = status === "submitted" || status === "streaming";
  const isStreaming = status === "streaming";

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
  // Group `role: 'tool'` rows by the run they belong to so we can fold
  // them back onto the assistant turn that owns them. The AI SDK's
  // `UIMessage` model attaches tool I/O as `dynamic-tool` parts on the
  // assistant message; the database stores them as separate rows
  // (which is the right shape for audit + retrieval but the wrong
  // shape for direct UI rendering).
  const toolRowsByRun = new Map<string, PersistedMessage[]>();
  for (const m of persisted) {
    if (m.role !== "tool" || !m.runId) continue;
    const bucket = toolRowsByRun.get(m.runId);
    if (bucket) {
      bucket.push(m);
    } else {
      toolRowsByRun.set(m.runId, [m]);
    }
  }

  const out: UIMessage[] = [];
  for (const m of persisted) {
    if (m.role === "tool") continue;
    if (m.role === "system") continue;

    const parts: UIMessage["parts"] = [];
    if (m.role === "assistant" && m.runId) {
      const toolRows = toolRowsByRun.get(m.runId);
      if (toolRows) {
        for (const tool of toolRows) {
          if (!tool.toolName || !tool.toolCallId) continue;
          const hasOutput =
            tool.toolOutput !== undefined && tool.toolOutput !== null;
          parts.push({
            type: "dynamic-tool",
            toolName: tool.toolName,
            toolCallId: tool.toolCallId,
            state: hasOutput ? "output-available" : "input-available",
            input: (tool.toolInput ?? {}) as Record<string, unknown>,
            ...(hasOutput ? { output: tool.toolOutput } : {}),
          } as UIMessage["parts"][number]);
        }
      }
    }
    if (m.content) {
      parts.push({ type: "text", text: m.content, state: "done" });
    }

    out.push({
      id: m.id,
      role: m.role === "user" ? "user" : "assistant",
      parts,
    } as UIMessage);
  }
  return out;
}
