"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  BookOpen,
  FileText,
  Calculator,
  FlaskConical,
  Globe,
  History,
  Paperclip,
  Mic,
  ArrowUp,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createThread, extractTitleFromMessage } from "@/lib/api/threads";
import { useUser } from "@/context/user-context";

const capabilities = [
  { icon: Sparkles, label: "Reasoning" },
  { icon: BookOpen, label: "Exam Prep" },
  { icon: FileText, label: "Summaries" },
];

const suggestions = [
  {
    icon: Calculator,
    title: "Mathematics",
    description: "Solve equations, understand theorems, and practice calculus problems.",
  },
  {
    icon: FlaskConical,
    title: "Sciences",
    description: "Explore physics, chemistry, and biology concepts with clear explanations.",
  },
  {
    icon: Globe,
    title: "History & Geography",
    description: "Review key events, analyze movements, and prepare for essay questions.",
  },
  {
    icon: History,
    title: "Philosophy",
    description: "Understand thinkers, build arguments, and structure your dissertation.",
  },
];

export default function NewChatPage() {
  const router = useRouter();
  const { userDetails } = useUser();
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstName = userDetails?.fullName?.split(' ')[0] || "there";

  const handleSendMessage = async () => {
    if (!message.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const title = extractTitleFromMessage(message, 50);
      const thread = await createThread(title);
      sessionStorage.setItem(`thread_${thread.id}_initial_message`, message);
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

  const handleSuggestionClick = (text: string) => {
    setMessage(`Help me study ${text.toLowerCase()}`);
  };

  return (
    <>
      <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-6 lg:p-8 overflow-y-auto">
        <div className="flex flex-col items-center gap-8 text-center max-w-2xl w-full">
          {/* Greeting */}
          <div className="flex flex-col items-center gap-3">
            <h1 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">
              Hello {firstName}
            </h1>
            <p className="text-lg text-muted-foreground">
              How can I assist you today?
            </p>
          </div>

          {/* Input Area */}
          <div className="w-full max-w-xl">
            <div className="relative flex flex-col bg-card rounded-2xl border border-border/60 shadow-sm focus-within:border-primary/30 focus-within:shadow-md transition-all overflow-hidden">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent border-0 focus-visible:ring-0 shadow-none resize-none min-h-[56px] max-h-[160px] px-4 pt-4 pb-2 text-sm placeholder:text-muted-foreground/50 leading-relaxed scrollbar-none"
                placeholder="What can I do for you?"
                rows={1}
                disabled={isLoading}
              />
              <div className="flex items-center justify-between px-3 pb-3">
                <div className="flex items-center gap-1">
                  {capabilities.map((cap) => {
                    const Icon = cap.icon;
                    return (
                      <span
                        key={cap.label}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-muted-foreground bg-muted/50"
                      >
                        <Icon className="h-3 w-3" />
                        {cap.label}
                      </span>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-muted-foreground/60 hover:text-foreground"
                    disabled={isLoading}
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-muted-foreground/60 hover:text-foreground"
                    disabled={isLoading}
                  >
                    <Mic className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={handleSendMessage}
                    disabled={!message.trim() || isLoading}
                    size="icon"
                    className={`h-8 w-8 rounded-full transition-all ${
                      message.trim()
                        ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                        : "bg-muted/50 text-muted-foreground/40 cursor-not-allowed"
                    }`}
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUp className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Explore Topics */}
          <div className="w-full max-w-xl pt-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-foreground">Explore topics</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {suggestions.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.title}
                    onClick={() => handleSuggestionClick(item.title)}
                    disabled={isLoading}
                    className="flex gap-3 p-4 rounded-xl border border-border/60 bg-card text-left hover:border-primary/30 hover:shadow-sm transition-all group disabled:opacity-50"
                  >
                    <div className="shrink-0 h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground mb-0.5">{item.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
