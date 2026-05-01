"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ArrowUp, Square, Sparkles, BookOpen, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLemmaChat } from "@/hooks/useChat";
import { CustomUserMessage, CustomAssistantMessage } from "@/components/chat/CustomMessages";
import { getThread } from "@/lib/api/threads";

const modes = [
  { id: 'general', label: 'General', icon: Sparkles },
  { id: 'exam', label: 'Exam Prep', icon: BookOpen },
  { id: 'summary', label: 'Summary', icon: FileText },
];

export default function ChatThreadPage() {
  const params = useParams();
  const router = useRouter();
  const threadId = params.id as string;
  
  const [input, setInput] = useState("");
  const [selectedMode, setSelectedMode] = useState(modes[0]);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isValidating) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Validating access...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto scroll-smooth">
        <div className="mx-auto max-w-3xl space-y-1 px-4 py-6">
          {!isInitialized && (
            <div className="text-center text-muted-foreground py-12">
              <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin mx-auto mb-4" />
              <p className="text-sm">Loading conversation...</p>
            </div>
          )}

          {isInitialized && hasOlder && (
            <div className="flex justify-center pb-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => loadOlder()}
                className="rounded-full border bg-card/70 px-4 text-xs text-muted-foreground hover:text-foreground"
              >
                Load older messages
              </Button>
            </div>
          )}

          {isInitialized && messages.length === 0 && !isLoading && (
            <div className="py-16 text-center text-muted-foreground">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent shadow-sm">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <p className="text-lg font-semibold text-foreground">Start a conversation</p>
              <p className="text-sm mt-1">Ask me anything about your Baccalaureate studies</p>
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
              <div className="bg-destructive/10 text-destructive rounded-xl px-4 py-2.5 text-sm">
                {error}
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-gradient-to-t from-background via-background to-transparent px-4 pb-5 pt-2">
        <div className="max-w-3xl mx-auto">
          <div className="flex flex-col overflow-hidden rounded-2xl border bg-card/85 shadow-xl shadow-primary/5 backdrop-blur transition-all focus-within:shadow-2xl focus-within:shadow-primary/10">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask anything in ${selectedMode.label} mode...`}
              className="w-full resize-none border-0 bg-transparent px-5 pb-2 pt-4 text-sm leading-relaxed shadow-none scrollbar-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
              disabled={isLoading}
              rows={1}
            />

            <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
              {/* Mode Selection */}
              <div className="flex flex-wrap items-center gap-1.5">
                {modes.map((mode) => {
                  const Icon = mode.icon;
                  const isActive = selectedMode.id === mode.id;
                  return (
                    <button
                      key={mode.id}
                      onClick={() => setSelectedMode(mode)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${
                        isActive 
                          ? "bg-primary/10 text-primary" 
                          : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"
                      }`}
                    >
                      <Icon className="h-3 w-3" />
                      {mode.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-end">
                <div className="pl-0.5">
                  {isLoading ? (
                    <Button
                      onClick={handleStop}
                      size="icon"
                      className="h-10 w-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                    >
                      <Square className="h-3 w-3 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleSend}
                      disabled={!input.trim()}
                      size="icon"
                      className={`h-10 w-10 rounded-full transition-all ${
                        input.trim() 
                          ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm" 
                          : "bg-muted/50 text-muted-foreground/40 cursor-not-allowed"
                      }`}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
