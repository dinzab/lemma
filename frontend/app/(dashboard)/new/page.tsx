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
  ArrowUp,
  Loader2,
  ArrowUpRight,
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
      <div className="flex-1 overflow-y-auto px-4 py-8 md:px-6 lg:px-8">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col items-center justify-center gap-8 text-center">
          {/* Greeting */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative inline-flex items-center gap-2 rounded-full border bg-muted px-3 py-1 text-sm text-muted-foreground shadow-sm">
              <span className="flex h-5 items-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground">
                AI Tutor
              </span>
              Ready for today&apos;s Bac session
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
              Hello {firstName}, what should we master today?
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              Ask for explanations, past-paper practice, summaries, or a study plan tuned to your section.
            </p>
          </div>

          {/* Input Area */}
          <div className="w-full max-w-2xl">
            <div className="relative flex flex-col overflow-hidden rounded-2xl border bg-card/85 shadow-xl shadow-primary/5 backdrop-blur focus-within:shadow-2xl focus-within:shadow-primary/10 transition-all">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full resize-none border-0 bg-transparent px-5 pb-2 pt-5 text-base leading-relaxed shadow-none scrollbar-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
                placeholder="Example: Explain derivatives from the Bac Math section..."
                rows={1}
                disabled={isLoading}
              />
              <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-1.5">
                  {capabilities.map((cap) => {
                    const Icon = cap.icon;
                    return (
                      <span
                        key={cap.label}
                        className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                      >
                        <Icon className="h-3 w-3" />
                        {cap.label}
                      </span>
                    );
                  })}
                </div>
                <div className="flex items-center justify-end">
                  <Button
                    onClick={handleSendMessage}
                    disabled={!message.trim() || isLoading}
                    size="icon"
                    className={`h-10 w-10 rounded-full transition-all ${
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

          <div className="w-full max-w-4xl pt-2">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">Explore topics</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {suggestions.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.title}
                    onClick={() => handleSuggestionClick(item.title)}
                    disabled={isLoading}
                    className="group flex gap-4 rounded-2xl border bg-card/70 p-5 text-left shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md disabled:opacity-50"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent transition-colors group-hover:bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground mb-0.5">{item.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
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
