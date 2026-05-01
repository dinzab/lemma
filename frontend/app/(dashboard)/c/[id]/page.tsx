"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLemmaChat } from "@/hooks/useChat";
import { CustomUserMessage, CustomAssistantMessage } from "@/components/chat/CustomMessages";
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    isLoading,
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
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(threadId)) {
        console.error('Invalid thread ID format');
        router.replace('/new');
        return;
      }

      try {
        const thread = await getThread(threadId);
        if (!thread) {
          console.error('Thread not found or not authorized');
          router.replace('/new');
          return;
        }
        setIsValidating(false);
        setHasValidated(true);
      } catch (err) {
        console.error('Failed to validate thread:', err);
        router.replace('/new');
      }
    };

    validateThread();
  }, [threadId, router]);

  useEffect(() => {
    if (!hasValidated || !isInitialized || initialMessageSentRef.current || messages.length > 0) return;

    const storageKey = `thread_${threadId}_initial_message`;
    const initialMessage = sessionStorage.getItem(storageKey);

    if (initialMessage) {
      initialMessageSentRef.current = true;
      sessionStorage.removeItem(storageKey);
      sendMessage(initialMessage);
    }
  }, [hasValidated, isInitialized, threadId, messages.length, sendMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const message = input;
    setInput("");
    await sendMessage(message);
  };

  const handleStop = () => {
    stopGeneration();
  };

  if (isValidating) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Validating access...</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[5%] h-72 w-[26rem] -translate-x-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>
      <div className="flex h-full flex-1 flex-col">
        {/* Messages Area */}
        <div className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
          <div className="mx-auto max-w-3xl space-y-1 px-4 py-5">
            {!isInitialized && (
              <div className="py-12 text-center text-muted-foreground">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                <p className="text-sm">Loading conversation...</p>
              </div>
            )}

            {isInitialized && hasOlder && (
              <div className="flex justify-center pb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => loadOlder()}
                  className="rounded-full border bg-card px-4 text-xs text-muted-foreground hover:text-foreground"
                >
                  Load older messages
                </Button>
              </div>
            )}

            {isInitialized && messages.length === 0 && !isLoading && (
              <div className="py-16 text-center text-muted-foreground">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border bg-muted/50 shadow-sm">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <p className="text-lg font-semibold text-foreground">Start a conversation</p>
                <p className="mt-1 text-sm">Ask me anything about your Baccalaureate studies</p>
              </div>
            )}

            {messages.map((message, index) => {
              if (message.role === 'user') {
                return <CustomUserMessage key={message.id} message={message} />;
              } else if (message.role === 'tool') {
                return null;
              } else if (message.role === 'system') {
                return null;
              } else {
                return (
                  <CustomAssistantMessage
                    key={message.id}
                    message={message}
                    isLoading={isLoading && index === messages.length - 1}
                    isLastMessage={index === messages.length - 1}
                    onRegenerate={regenerateLastMessage}
                  />
                );
              }
            })}

            {error && (
              <div className="flex justify-center py-2">
                <div className="rounded-xl bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
                  {error}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-3 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <PromptComposer
              value={input}
              onChange={setInput}
              onSubmit={handleSend}
              onStop={handleStop}
              isStreaming={isLoading}
              placeholder="Ask anything…"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
