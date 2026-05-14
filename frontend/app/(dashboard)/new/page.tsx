"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  BookOpen,
  FileText,
  Languages,
  TimerReset,
} from "lucide-react";
import { createThread, extractTitleFromMessage } from "@/lib/api/threads";
import { useUser } from "@/context/user-context";
import { PromptComposer, type PromptComposerMode } from "@/components/chat/PromptComposer";
import { TutorShowcase } from "@/components/chat/TutorShowcase";
import { cn } from "@/lib/utils";

const capabilities: PromptComposerMode[] = [
  { id: "reasoning", label: "Reasoning", icon: Sparkles },
  { id: "exam", label: "Exam Prep", icon: BookOpen },
  { id: "summaries", label: "Summaries", icon: FileText },
];

const MODE_PLACEHOLDERS: Record<string, string> = {
  reasoning: "Walk me through this problem step by step…",
  exam: "Generate a past-paper style question on…",
  summaries: "Summarise this lesson / chapter on…",
};

const DEFAULT_PLACEHOLDER =
  "Example: Explain derivatives from the Bac Math section…";

export default function NewChatPage() {
  const router = useRouter();
  const { userDetails } = useUser();
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Selected capability mode (Reasoning / Exam Prep / Summaries). Currently
  // a UI-only signal — the backend agent doesn't branch on it yet — but
  // wiring the selection state means the chips actually toggle and the
  // placeholder updates so users get tangible feedback when they pick one.
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);

  const placeholder = selectedModeId
    ? (MODE_PLACEHOLDERS[selectedModeId] ?? DEFAULT_PLACEHOLDER)
    : DEFAULT_PLACEHOLDER;

  const handleSelectMode = (id: string) => {
    setSelectedModeId((current) => (current === id ? null : id));
  };

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

  const handlePickPrompt = (prompt: string) => {
    setMessage(prompt);
  };

  return (
    <div className="no-scrollbar relative flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Top toolbar — inline at the top on mobile, absolute-positioned on
          ≥sm so it doesn't steal vertical space from the hero. */}
      <div className="flex items-center justify-end gap-2 px-4 pt-3 sm:absolute sm:right-6 sm:top-5 sm:z-10 sm:px-0 sm:pt-0">
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors sm:px-3 sm:py-1.5 sm:text-xs",
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

      {/* Hero / composer column. We deliberately do NOT vertically centre
          the whole page anymore — the showcase below the composer is the
          tall element that justifies always anchoring to the top of the
          scroll container, otherwise the composer would jump up/down as
          the user scrolls between the hero and the showcase. */}
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-start gap-6 px-4 pb-10 pt-6 text-center sm:max-w-3xl sm:gap-10 sm:px-6 sm:pt-12 lg:px-8">
        {/* Hero */}
        <div className="flex flex-col items-center gap-3 sm:gap-4">
          <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span className="font-semibold uppercase tracking-wide text-primary">
              AI Tutor
            </span>
            {/* The session-status tail is decorative; on narrow viewports
                we drop it so the pill never forces horizontal scroll. */}
            <span className="hidden h-3 w-px bg-border/70 sm:inline-block" aria-hidden />
            <span className="hidden sm:inline">Ready for today&apos;s Bac session</span>
          </span>

          <h1 className="max-w-3xl text-balance text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl lg:text-[2.875rem]">
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
            placeholder={placeholder}
            isSubmitting={isLoading}
            modes={capabilities}
            selectedModeId={selectedModeId ?? undefined}
            onSelectMode={handleSelectMode}
            size="hero"
            autoFocus
          />

          {error && (
            <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-left text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Capability showcase — same rotating-tabs + WorkflowAnimation
            surface as the marketing FeaturesSection, sharing tab specs via
            `TUTOR_CAPABILITY_TABS`. The CTA prefills the composer above. */}
        <div className="w-full text-left">
          <TutorShowcase
            onPickPrompt={handlePickPrompt}
            disabled={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
