"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calculator,
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
}

const suggestions: SuggestionTopic[] = [
  { icon: Calculator, title: "Mathematics" },
  { icon: FlaskConical, title: "Sciences" },
  { icon: Globe, title: "History & Geography" },
];

function HeroBurst({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="currentColor"
      aria-hidden
      className={cn("text-primary", className)}
    >
      <polygon points="50,2 53,50 50,98 47,50" />
      <polygon points="2,50 50,47 98,50 50,53" />
      <g transform="rotate(45 50 50)">
        <polygon points="50,18 51.5,50 50,82 48.5,50" />
        <polygon points="18,50 50,48.5 82,50 50,51.5" />
      </g>
    </svg>
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
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            <HeroBurst className="h-9 w-9 sm:h-10 sm:w-10" />
            <span>
              Hello,{" "}
              <span className="text-cyan-600 dark:text-cyan-400">{firstName}</span>
            </span>
          </h1>
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

        {/* Suggestion chips (below composer, like claude.ai) */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {suggestions.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.title}
                type="button"
                onClick={() => handleSuggestionClick(item.title)}
                disabled={isLoading}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3.5 py-1.5 text-[13px] font-medium text-foreground/80 transition-colors",
                  "hover:border-border hover:bg-card hover:text-foreground",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                <Icon className="h-[15px] w-[15px] text-muted-foreground" />
                {item.title}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
