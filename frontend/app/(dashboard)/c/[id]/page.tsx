"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLemmaChat } from "@/hooks/useChat";
import { LemmaConversation } from "@/components/chat/LemmaConversation";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { deleteThread, getThread, renameThread } from "@/lib/api/threads";
import { PromptComposer } from "@/components/chat/PromptComposer";
import { useThreads } from "@/context/threads-context";

interface ActiveRunResponse {
  runId: string | null;
  status: "running" | "completed" | "failed" | "cancelled" | "idle";
}

export default function ChatThreadPage() {
  const params = useParams();
  const router = useRouter();
  const threadId = params.id as string;

  const [input, setInput] = useState("");
  const [isValidating, setIsValidating] = useState(true);
  const [hasValidated, setHasValidated] = useState(false);
  const [threadTitle, setThreadTitle] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRunResponse | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const initialMessageSentRef = useRef(false);

  const { threads, applyRename, removeThread } = useThreads();

  // Prefer the title from the threads context — that way a rename done from
  // the sidebar reflects in the chat header (and vice versa) without an
  // extra refetch.
  const contextTitle = threads.find((t) => t.id === threadId)?.title ?? null;
  const headerTitle = contextTitle ?? threadTitle;

  const {
    messages,
    isLoading,
    isStreaming,
    error,
    isInitialized,
    sendMessage,
    stopGeneration,
    regenerateLastMessage,
    loadOlder,
    hasOlder,
  } = useLemmaChat({ threadId });

  useEffect(() => {
    const validateThread = async () => {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(threadId)) {
        console.error("Invalid thread ID format");
        router.replace("/new");
        return;
      }

      try {
        const thread = await getThread(threadId);
        if (!thread) {
          console.error("Thread not found or not authorized");
          router.replace("/new");
          return;
        }
        setThreadTitle(thread.title);
        setIsValidating(false);
        setHasValidated(true);
      } catch (err) {
        console.error("Failed to validate thread:", err);
        router.replace("/new");
      }
    };

    validateThread();
  }, [threadId, router]);

  // Resume-on-reload: once the thread is validated, ask the backend
  // whether the most recent run is still `running` (page was reloaded
  // mid-stream) or `failed` (server restart killed the previous turn).
  // The full Redis Streams replay is deferred — here we only surface a
  // banner so the user can decide whether to retry.
  useEffect(() => {
    if (!hasValidated) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/threads/${threadId}/active-run`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = (await res.json()) as ActiveRunResponse;
        if (!cancelled) {
          setActiveRun(data);
        }
      } catch (err) {
        console.warn("active-run probe failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasValidated, threadId]);

  useEffect(() => {
    if (
      !hasValidated ||
      !isInitialized ||
      initialMessageSentRef.current ||
      messages.length > 0
    )
      return;

    const storageKey = `thread_${threadId}_initial_message`;
    const initialMessage = sessionStorage.getItem(storageKey);

    if (initialMessage) {
      initialMessageSentRef.current = true;
      sessionStorage.removeItem(storageKey);
      sendMessage(initialMessage);
    }
  }, [hasValidated, isInitialized, threadId, messages.length, sendMessage]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;
    const message = input;
    setInput("");
    await sendMessage(message);
  }, [input, isLoading, sendMessage]);

  const handleStop = useCallback(() => {
    stopGeneration();
  }, [stopGeneration]);

  const handleResumeRetry = useCallback(() => {
    setResumeDismissed(true);
    if (!isLoading) {
      regenerateLastMessage();
    }
  }, [isLoading, regenerateLastMessage]);

  const showResumeBanner =
    !resumeDismissed &&
    activeRun !== null &&
    !isLoading &&
    (activeRun.status === "running" || activeRun.status === "failed");

  const handleRename = useCallback(
    async (nextTitle: string) => {
      try {
        const updated = await renameThread(threadId, nextTitle);
        applyRename(updated);
        setThreadTitle(updated.title);
        toast.success("Chat renamed");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to rename chat",
        );
        throw error;
      }
    },
    [threadId, applyRename],
  );

  const handleDelete = useCallback(async () => {
    try {
      await deleteThread(threadId);
      removeThread(threadId);
      toast.success("Chat deleted");
      router.push("/new");
    } catch (error) {
      toast.error("Failed to delete chat");
      throw error;
    }
  }, [threadId, removeThread, router]);

  if (isValidating) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="h-7 w-7 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
        <p className="text-xs text-muted-foreground">Opening conversation…</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[5%] h-72 w-[26rem] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>
      <div className="flex h-full flex-1 flex-col">
        <ChatHeader
          title={headerTitle}
          onRename={handleRename}
          onDelete={handleDelete}
        />

        {/* Resume banner — shown when a previous run was interrupted. */}
        {showResumeBanner && activeRun && (
          <div className="mx-auto mt-3 flex w-full max-w-3xl items-center gap-3 rounded-xl border border-amber-300/40 bg-amber-50/60 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertCircle className="size-4 shrink-0" />
            <span className="flex-1 truncate">
              {activeRun.status === "running"
                ? "Your previous response was still streaming when this page reloaded. Stream replay isn't supported yet — retry to regenerate it."
                : "Your previous response didn't finish. You can retry it."}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResumeRetry}
              className="h-7 px-2 text-xs hover:bg-amber-100/80 dark:hover:bg-amber-500/20"
            >
              <RefreshCw className="mr-1 size-3" />
              Retry
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setResumeDismissed(true)}
              className="h-7 px-2 text-xs hover:bg-amber-100/80 dark:hover:bg-amber-500/20"
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Messages area */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {!isInitialized ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                <p className="text-sm">Loading conversation...</p>
              </div>
            </div>
          ) : (
            <div className="relative flex h-full flex-col">
              {hasOlder && (
                <div className="absolute left-0 right-0 top-2 z-10 flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => loadOlder()}
                    className="rounded-full border bg-card/90 px-4 text-xs text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
                  >
                    Load older messages
                  </Button>
                </div>
              )}
              <LemmaConversation
                messages={messages}
                isLoading={isLoading}
                isStreaming={isStreaming}
              />
            </div>
          )}
        </div>

        {error && (
          <div className="mx-auto w-full max-w-3xl px-3 pb-2 sm:px-4">
            <div className="rounded-xl bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
              {error}
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background via-background/95 to-background/0 px-3 pb-3 pt-4 sm:px-6 sm:pb-4">
          <div className="mx-auto w-full max-w-3xl">
            <PromptComposer
              value={input}
              onChange={setInput}
              onSubmit={handleSend}
              onStop={handleStop}
              isStreaming={isLoading}
              placeholder="Ask anything…"
            />
            <p className="mt-2 hidden text-center text-[11px] leading-4 text-muted-foreground/70 sm:block">
              BacPrep AI can make mistakes. Verify important information.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
