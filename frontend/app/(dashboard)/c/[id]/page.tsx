"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useLemmaChat } from "@/hooks/useChat";
import { LemmaConversation } from "@/components/chat/LemmaConversation";
import { getThread } from "@/lib/api/threads";
import { PromptComposer } from "@/components/chat/PromptComposer";

export default function ChatThreadPage() {
  const params = useParams();
  const router = useRouter();
  const threadId = params.id as string;

  const [input, setInput] = useState("");
  const [isValidating, setIsValidating] = useState(true);
  const [hasValidated, setHasValidated] = useState(false);
  const initialMessageSentRef = useRef(false);

  const {
    messages,
    isLoading,
    isStreaming,
    isReconnecting,
    error,
    isInitialized,
    sendMessage,
    stopGeneration,
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
        setIsValidating(false);
        setHasValidated(true);
      } catch (err) {
        console.error("Failed to validate thread:", err);
        router.replace("/new");
      }
    };

    validateThread();
  }, [threadId, router]);

  // Resume-on-reload happens automatically inside `useLemmaChat`: it
  // probes `/threads/:id/active-run` and re-attaches to the in-memory
  // RunStreamHub via `/chat/stream/resume?runId=…` with auto-reconnect
  // + exponential backoff. The page no longer needs to render an
  // "interrupted" banner — the streaming UI just keeps going.

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
                isReconnecting={isReconnecting}
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
