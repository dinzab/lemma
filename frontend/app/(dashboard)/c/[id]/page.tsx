"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { Paperclip, Mic, ArrowUp, Square, Sparkles, BookOpen, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgent } from "@/hooks/useAgent";
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
  const [initialMessageSent, setInitialMessageSent] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Use AG-UI agent hook
  const { 
    messages, 
    isLoading, 
    error, 
    isInitialized,
    sendMessage, 
    stopGeneration,
    regenerateLastMessage,
  } = useAgent({
    threadId,
    agentUrl: process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:8123/agent",
  });

  // Validate thread ownership on mount
  useEffect(() => {
    const validateThread = async () => {
      // Skip validation if threadId is not a valid UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(threadId)) {
        console.error('Invalid thread ID format');
        router.replace('/new');
        return;
      }

      try {
        // Validate thread exists and belongs to user via API route
        // Auth is handled server-side using cookies
        const thread = await getThread(threadId);

        if (!thread) {
          // Thread not found or not authorized - redirect to new
          console.error('Thread not found or not authorized');
          router.replace('/new');
          return;
        }

        // Thread is valid!
        setIsValidating(false);
        setHasValidated(true);
      } catch (err) {
        console.error('Failed to validate thread:', err);
        router.replace('/new');
      }
    };

    validateThread();
  }, [threadId, router]);

  // Handle initial message from new chat creation
  useEffect(() => {
    if (!hasValidated || !isInitialized || initialMessageSent || messages.length > 0) return;

    // Check for initial message in sessionStorage
    const storageKey = `thread_${threadId}_initial_message`;
    const initialMessage = sessionStorage.getItem(storageKey);

    if (initialMessage) {
      // Clear from storage immediately to prevent re-sending
      sessionStorage.removeItem(storageKey);
      
      // Send the initial message
      setInitialMessageSent(true);
      sendMessage(initialMessage);
    }
  }, [hasValidated, isInitialized, threadId, initialMessageSent, messages.length, sendMessage]);

  // Auto-scroll to bottom when messages change
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

  // Show loading while validating thread
  if (isValidating) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin mb-4" />
        <p className="text-sm text-muted-foreground">Validating access...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 scroll-smooth">
        <div className="max-w-3xl mx-auto space-y-4 pb-4">
          {/* Loading state while restoring messages */}
          {!isInitialized && (
            <div className="text-center text-muted-foreground py-8">
              <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin mx-auto mb-4" />
              <p className="text-sm">Loading conversation...</p>
            </div>
          )}

          {/* Empty state - only show when initialized and no messages */}
          {isInitialized && messages.length === 0 && !isLoading && (
            <div className="text-center text-muted-foreground py-8">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <p className="text-lg font-medium">Start a conversation</p>
              <p className="text-sm mt-1">Ask me anything about your Baccalaureate studies</p>
            </div>
          )}
          
          {messages.map((message, index) => {
            if (message.role === 'user') {
              return <CustomUserMessage key={message.id} message={message} />;
            } else if (message.role === 'tool') {
              return null; // Tool results are now integrated into the assistant message
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
            <div className="flex justify-center">
              <div className="bg-destructive/10 text-destructive rounded-lg px-4 py-2 text-sm">
                {error}
              </div>
            </div>
          )}
          
          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="p-6 bg-background/80 backdrop-blur-sm border-t border-border/40">
        <div className="max-w-3xl mx-auto flex flex-col bg-secondary/40 rounded-[26px] border border-border/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all shadow-sm overflow-hidden relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask anything in ${selectedMode.label} mode...`}
            className="w-full bg-transparent border-0 focus-visible:ring-0 shadow-none resize-none min-h-[60px] max-h-[200px] p-4 text-sm placeholder:text-muted-foreground/50 leading-relaxed scrollbar-none"
            disabled={isLoading}
            rows={1}
          />

          <div className="flex justify-between items-center px-3 pb-3 pt-1">
            {/* Left: Mode Selection Tabs */}
            <div className="flex items-center gap-1">
              {modes.map((mode) => {
                const Icon = mode.icon;
                const isActive = selectedMode.id === mode.id;
                return (
                  <Button
                    key={mode.id}
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedMode(mode)}
                    className={`h-8 px-3 rounded-full text-xs font-medium transition-all border ${
                      isActive 
                        ? "bg-primary/10 text-primary border-primary/20 shadow-sm" 
                        : "text-muted-foreground/70 hover:text-foreground hover:bg-background/50 border-transparent hover:border-border/40"
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 mr-1.5 ${isActive ? "text-primary" : "opacity-70"}`} />
                    {mode.label}
                  </Button>
                );
              })}
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground/70 hover:text-foreground rounded-full hover:bg-background/50 transition-colors"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground/70 hover:text-foreground rounded-full hover:bg-background/50 transition-colors"
              >
                <Mic className="h-4 w-4" />
              </Button>

              <div className="pl-1">
                {isLoading ? (
                  <Button
                    onClick={handleStop}
                    size="icon"
                    className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm transition-all animate-in fade-in zoom-in duration-200"
                  >
                    <Square className="h-3 w-3 fill-current" />
                  </Button>
                ) : (
                  <Button
                    onClick={handleSend}
                    disabled={!input.trim()}
                    size="icon"
                    className={`h-8 w-8 rounded-full transition-all duration-200 ${
                      input.trim() 
                        ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm" 
                        : "bg-muted/50 text-muted-foreground/50 cursor-not-allowed"
                    }`}
                  >
                    <ArrowUp className="h-5 w-5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
