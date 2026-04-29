"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import type { Message, ToolCall } from "@/components/chat/CustomMessages";

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
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  toolCallId?: string;
  toolName?: string;
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
 * The returned shape mirrors the legacy `useAgent` API so the existing
 * `CustomMessages` rendering code keeps working unchanged. Internally
 * everything goes through the v5 UI message stream protocol —
 * `text-start`/`text-delta`/`text-end` for text, plus
 * `tool-input-available`/`tool-output-available` for tool calls.
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

  // Stable transport across renders — `useChat` re-instantiates heavy state
  // when it sees a different transport reference.
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
          // 404/403 → empty thread is a normal first-load.
          if (cancelled) return;
          setMessages([]);
          setSeededAt(threadId);
          setIsInitialized(true);
          return;
        }
        const page = (await res.json()) as MessagesPage;
        if (cancelled) return;
        setMessages(toUiMessages(page.messages));
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
    // historyApi/setMessages intentionally not in deps — historyApi is a
    // closure over threadId, and setMessages is stable per useChat instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Convert AI SDK UIMessage[] back to the legacy Message[] shape the existing
  // renderer (CustomMessages.tsx) consumes. Done lazily per render.
  const messages: Message[] = useMemo(() => {
    if (!seededAt) return [];
    return aiMessages.map(uiMessageToLegacy);
  }, [aiMessages, seededAt]);

  const sendText = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      return sendMessage({ text });
    },
    [sendMessage],
  );

  const stopGeneration = useCallback(() => stop(), [stop]);

  const regenerateLastMessage = useCallback(
    () => regenerate(),
    [regenerate],
  );

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
    setMessages((prev) => [...toUiMessages(page.messages), ...prev]);
    setOlderCursor(page.nextCursor);
  }, [historyApi, olderCursor, setMessages, threadId]);

  const isLoading = status === "submitted" || status === "streaming";

  return {
    messages,
    isLoading,
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
  // Build a tool result lookup so we can fold tool messages back into the
  // assistant turn that owns them — Vercel AI SDK's UI uses one message
  // with tool-* parts rather than separate role: 'tool' messages.
  const toolResults = new Map<string, string>();
  for (const m of persisted) {
    if (m.role === "tool" && m.toolCallId) {
      toolResults.set(m.toolCallId, m.content ?? "");
    }
  }

  const out: UIMessage[] = [];
  for (const m of persisted) {
    if (m.role === "tool") continue;
    if (m.role === "system") continue;

    const parts: UIMessage["parts"] = [];
    if (m.content) {
      parts.push({ type: "text", text: m.content, state: "done" });
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      for (const tc of m.toolCalls) {
        const result = toolResults.get(tc.id);
        parts.push({
          type: "dynamic-tool",
          toolName: tc.name,
          toolCallId: tc.id,
          state: result ? "output-available" : "input-available",
          input: tc.args ?? {},
          // `output` only valid on the output-available variant; cast keeps
          // the discriminated union happy at runtime.
          ...(result ? { output: safeParse(result) } : {}),
        } as UIMessage["parts"][number]);
      }
    }

    out.push({
      id: m.id,
      role: m.role === "user" ? "user" : "assistant",
      parts,
    } as UIMessage);
  }
  return out;
}

function uiMessageToLegacy(m: UIMessage): Message {
  let text = "";
  const toolCalls: ToolCall[] = [];
  let toolCallId: string | undefined;
  let toolName: string | undefined;

  for (const p of m.parts ?? []) {
    if (p.type === "text") {
      text += p.text;
      continue;
    }
    if (
      p.type === "dynamic-tool" ||
      (typeof p.type === "string" && p.type.startsWith("tool-"))
    ) {
      const part = p as Record<string, unknown> & {
        type: string;
        toolName?: string;
        toolCallId?: string;
        state?: string;
        input?: unknown;
        output?: unknown;
        errorText?: string;
      };
      const status = mapToolState(part.state);
      toolCalls.push({
        id: part.toolCallId ?? "",
        name:
          part.toolName ??
          (part.type.startsWith("tool-")
            ? part.type.slice("tool-".length)
            : "tool"),
        args: part.input ?? {},
        result:
          part.output !== undefined
            ? part.output
            : part.errorText
              ? { error: part.errorText }
              : undefined,
        status,
      });
    }
  }

  return {
    id: m.id,
    role:
      m.role === "user"
        ? "user"
        : m.role === "system"
          ? "system"
          : "assistant",
    content: text,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    toolCallId,
    toolName,
  };
}

function mapToolState(state: string | undefined): ToolCall["status"] {
  switch (state) {
    case "input-streaming":
    case "input-available":
      return "executing";
    case "output-available":
      return "complete";
    case "output-error":
    case "output-denied":
      return "error";
    default:
      return "pending";
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
