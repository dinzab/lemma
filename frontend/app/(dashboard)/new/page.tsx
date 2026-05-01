"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
  ChevronRight,
  FlaskConical,
  Globe,
  Languages,
  TimerReset,
  type LucideIcon,
} from "lucide-react";
import { createThread, extractTitleFromMessage } from "@/lib/api/threads";
import { useUser } from "@/context/user-context";
import { PromptComposer } from "@/components/chat/PromptComposer";
import { cn } from "@/lib/utils";

interface SuggestionTopic {
  icon: LucideIcon;
  title: string;
  description: string;
}

const suggestions: SuggestionTopic[] = [
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
];

function HeroOrb() {
  return (
    <div
      aria-hidden
      className="relative h-20 w-20 sm:h-24 sm:w-24"
    >
      <div className="absolute -inset-3 rounded-full bg-gradient-to-br from-primary/15 via-amber-200/20 to-rose-200/20 blur-2xl dark:from-primary/25 dark:via-amber-400/10 dark:to-rose-400/10" />
      <div className="relative h-full w-full overflow-hidden rounded-full shadow-[0_8px_32px_-12px_rgba(204,120,92,0.35)]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#f5e2c8] via-[#ecc8a6] to-[#cc785c] dark:from-[#3a3429] dark:via-[#5a4a3a] dark:to-[#cc785c]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.85),transparent_45%)] dark:bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.4),transparent_45%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_70%,rgba(204,120,92,0.55),transparent_55%)]" />
        <div className="absolute inset-x-0 top-2 mx-auto h-4 w-10 rounded-full bg-white/55 blur-md" />
      </div>
    </div>
  );
}

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
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-card/80 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          <Languages className="h-4 w-4" />
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 pb-12 pt-16 sm:px-6 sm:pt-20 lg:px-8">
        {/* Hero */}
        <div className="flex flex-col items-center gap-5 text-center">
          <HeroOrb />
          <div className="space-y-1">
            <h1 className="font-display text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
              Hello {firstName}
            </h1>
            <p className="font-display text-3xl font-normal text-foreground/70 sm:text-4xl">
              How can I assist you today?
            </p>
          </div>
        </div>

        {/* Composer */}
        <div className="w-full">
          <PromptComposer
            value={message}
            onChange={setMessage}
            onSubmit={handleSendMessage}
            placeholder="What can I do for you?"
            isSubmitting={isLoading}
            autoFocus
          />

          {error && (
            <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-left text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Topic suggestions */}
        <div className="w-full">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-base font-semibold text-foreground">
              Explore new ideas
            </h2>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Show all
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
            {suggestions.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.title}
                  onClick={() => handleSuggestionClick(item.title)}
                  disabled={isLoading}
                  className={cn(
                    "group flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/70 p-4 transition-colors",
                    "hover:border-border hover:bg-card",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-background/80 text-muted-foreground transition-colors group-hover:text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      {item.title}
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
