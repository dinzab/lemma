"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Library, Lightbulb, Calculator, Paperclip, Mic, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createThread, extractTitleFromMessage } from "@/lib/api/threads";

export default function NewChatPage() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendMessage = async () => {
    if (!message.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      // Extract title from the message (first 50 chars, sanitized)
      const title = extractTitleFromMessage(message, 50);

      // Create the thread via Next.js API route (handles auth server-side)
      const thread = await createThread(title);

      // Store the initial message to be sent after redirect
      // We use sessionStorage so it persists through the redirect but not across tabs
      sessionStorage.setItem(`thread_${thread.id}_initial_message`, message);

      // Redirect to the thread page
      router.push(`/c/${thread.id}`);
    } catch (err) {
      console.error('Failed to create thread:', err);
      setError(err instanceof Error ? err.message : 'Failed to create thread. Please try again.');
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleQuickAction = (text: string) => {
    setMessage(text);
  };

  return (
    <>
      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 lg:p-8 overflow-y-auto">
        <div className="flex flex-col items-center gap-6 text-center max-w-xl w-full">
          <div className="bg-primary rounded-full p-4">
            <Library className="text-primary-foreground h-12 w-12" />
          </div>
          
          <div className="flex flex-col items-center gap-2">
            <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground">
              Hello! How can I help you study today?
            </h1>
            <p className="text-base text-muted-foreground">
              You can ask me anything from explaining photosynthesis to helping you with a math problem.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md pt-4">
            <button 
              onClick={() => handleQuickAction("Explain photosynthesis")}
              className="flex flex-1 gap-3 rounded-lg border border-border bg-card p-4 items-center hover:border-primary transition-colors cursor-pointer text-left disabled:opacity-50"
              disabled={isLoading}
            >
              <Lightbulb className="text-primary h-6 w-6 shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">Explain photosynthesis</h2>
            </button>
            
            <button 
              onClick={() => handleQuickAction("Help me with a math problem")}
              className="flex flex-1 gap-3 rounded-lg border border-border bg-card p-4 items-center hover:border-primary transition-colors cursor-pointer text-left disabled:opacity-50"
              disabled={isLoading}
            >
              <Calculator className="text-primary h-6 w-6 shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">Help me with a math problem</h2>
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="w-full max-w-md p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 md:p-6 bg-background">
        <div className="max-w-4xl mx-auto">
          <div className="relative flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              disabled={isLoading}
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[52px] w-full resize-none rounded-xl border-border bg-card py-3 pr-24 pl-12 placeholder:text-muted-foreground focus-visible:ring-primary"
              placeholder="Type your message here..."
              rows={1}
              disabled={isLoading}
            />
            
            <div className="absolute right-2 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                disabled={isLoading}
              >
                <Mic className="h-5 w-5" />
              </Button>
              
              <Button
                size="icon"
                className="h-9 w-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                onClick={handleSendMessage}
                disabled={!message.trim() || isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
