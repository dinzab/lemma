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
  ArrowUpRight,
  Languages,
  TimerReset,
  type LucideIcon,
} from "lucide-react";
import { createThread, extractTitleFromMessage } from "@/lib/api/threads";
import { useUser } from "@/context/user-context";
import { PromptComposer, type PromptComposerMode } from "@/components/chat/PromptComposer";
import { cn } from "@/lib/utils";

const capabilities: PromptComposerMode[] = [
  { id: "reasoning", label: "Reasoning", icon: Sparkles },
  { id: "exam", label: "Exam Prep", icon: BookOpen },
  { id: "summaries", label: "Summaries", icon: FileText },
];

interface SuggestionTopic {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Tailwind classes applied to the icon tile background. */
  iconClass: string;
  /** Tailwind classes for the icon glyph. */
  iconColor: string;
}

const suggestions: SuggestionTopic[] = [
  {
    icon: Calculator,
    title: "Mathematics",
    description: "Solve equations, understand theorems, and practice calculus problems.",
    iconClass: "bg-gradient-to-br from-primary/25 to-primary/5",
    iconColor: "text-primary",
  },
  {
    icon: FlaskConical,
    title: "Sciences",
    description: "Explore physics, chemistry, and biology concepts with clear explanations.",
    iconClass: "bg-gradient-to-br from-secondary/30 to-secondary/5",
    iconColor: "text-secondary",
  },
  {
    icon: Globe,
    title: "History & Geography",
    description: "Review key events, analyze movements, and prepare for essay questions.",
    iconClass: "bg-gradient-to-br from-chart-3/25 to-chart-3/5",
    iconColor: "text-chart-3",
  },
  {
    icon: History,
    title: "Philosophy",
    description: "Understand thinkers, build arguments, and structure your dissertation.",
    iconClass: "bg-gradient-to-br from-chart-5/25 to-chart-5/5",
    iconColor: "text-chart-5",
  },
];

export default function NewChatPage() {
  const router = useRouter();
  const { userDetails } = useUser();
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstName = userDetails?.fullName?.split(" ")[0] || "there";

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
      console.error("Failed to create thread:", err);
      setError(err instanceof Error ? err.message : "Failed to create thread. Please try again.");
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (text: string) => {
    setMessage(`Help me study ${text.toLowerCase()}`);
  };

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-y-auto">
      {/* Top toolbar */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2 sm:right-6 sm:top-5">
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors",
            "hover:bg-primary/15",
          )}
        >
          <TimerReset className="h-3.5 w-3.5" />
          temporary chat
        </button>
        <button
          type="button"
          aria-label="Change language"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <Languages className="h-4 w-4" />
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-10 px-4 py-10 text-center sm:px-6 lg:px-8">
        {/* Hero */}
        <div className="flex flex-col items-center gap-4">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span className="font-semibold uppercase tracking-wide text-primary">
              AI Tutor
            </span>
            <span className="h-3 w-px bg-border/70" aria-hidden />
            <span>Ready for today&apos;s Bac session</span>
          </span>

          <h1 className="max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl lg:text-[2.875rem]">
            Hello{" "}
            <span className="bg-gradient-to-br from-primary via-chart-3 to-secondary bg-clip-text text-transparent">
              {firstName}
            </span>
            , what should we master today?
          </h1>
          <p className="max-w-2xl text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
            Ask for explanations, past-paper practice, summaries, or a study plan tuned to your section.
          </p>
        </div>

        {/* Composer */}
        <div className="w-full">
          <PromptComposer
            value={message}
            onChange={setMessage}
            onSubmit={handleSendMessage}
            placeholder="Example: Explain derivatives from the Bac Math section…"
            isSubmitting={isLoading}
            modes={capabilities}
            autoFocus
          />

          {error && (
            <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-left text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Topic Suggestions */}
        <div className="w-full">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Explore topics
            </p>
            <p className="text-xs text-muted-foreground/80">
              Click a card to start
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 text-left sm:grid-cols-2">
            {suggestions.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.title}
                  onClick={() => handleSuggestionClick(item.title)}
                  disabled={isLoading}
                  className={cn(
                    "group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-border/70 bg-transparent p-4 transition-colors duration-200",
                    "hover:border-primary/40",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 transition-transform group-hover:scale-105",
                      item.iconClass,
                    )}
                  >
                    <Icon className={cn("h-5 w-5", item.iconColor)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 text-sm font-semibold text-foreground">
                      {item.title}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                  <ArrowUpRight
                    className={cn(
                      "h-4 w-4 shrink-0 -translate-x-1 translate-y-0 text-muted-foreground/60 opacity-0 transition-all",
                      "group-hover:translate-x-0 group-hover:opacity-100 group-hover:text-primary",
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
