"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  Sparkles,
  BookOpen,
  FileText,
  Calculator,
  FlaskConical,
  Globe,
  History,
  ArrowRight,
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

const MODE_PLACEHOLDERS: Record<string, string> = {
  reasoning: "Walk me through this problem step by step…",
  exam: "Generate a past-paper style question on…",
  summaries: "Summarise this lesson / chapter on…",
};

const DEFAULT_PLACEHOLDER =
  "Example: Explain derivatives from the Bac Math section…";

interface QuickAction {
  label: string;
  prompt: string;
}

interface TopicCard {
  icon: LucideIcon;
  title: string;
  description: string;
  gradient: string;
  accentColor: string;
  actions: QuickAction[];
}

const topics: TopicCard[] = [
  {
    icon: Calculator,
    title: "Mathematics",
    description:
      "Solve equations, understand theorems, and practice calculus problems.",
    gradient: "from-primary/15 via-primary/5 to-transparent",
    accentColor: "text-primary",
    actions: [
      { label: "Solve a problem", prompt: "Walk me through solving a Bac-level calculus problem step by step" },
      { label: "Past Bac paper", prompt: "Show me a past Bac math paper question on derivatives" },
      { label: "Concept explainer", prompt: "Explain limits and continuity for the Bac Math section" },
    ],
  },
  {
    icon: FlaskConical,
    title: "Sciences",
    description:
      "Explore physics, chemistry, and biology concepts with clear explanations.",
    gradient: "from-secondary/15 via-secondary/5 to-transparent",
    accentColor: "text-secondary",
    actions: [
      { label: "Physics problem", prompt: "Help me solve a mechanics problem from a past Bac Sciences exam" },
      { label: "Chemistry equation", prompt: "Explain how to balance this chemical equation for the Bac" },
      { label: "Biology summary", prompt: "Summarise the genetics chapter for Bac Sciences" },
    ],
  },
  {
    icon: Globe,
    title: "History & Geography",
    description:
      "Review key events, analyze movements, and prepare for essay questions.",
    gradient: "from-chart-3/15 via-chart-3/5 to-transparent",
    accentColor: "text-chart-3",
    actions: [
      { label: "Essay outline", prompt: "Help me outline a Bac essay on decolonisation in North Africa" },
      { label: "Key events recap", prompt: "Summarise the key events of the Cold War for the Bac" },
      { label: "Past Bac essay", prompt: "Show me a past Bac history essay question and model answer" },
    ],
  },
  {
    icon: History,
    title: "Philosophy",
    description:
      "Understand thinkers, build arguments, and structure your dissertation.",
    gradient: "from-chart-5/15 via-chart-5/5 to-transparent",
    accentColor: "text-chart-5",
    actions: [
      { label: "Dissertation plan", prompt: "Help me plan a philosophy dissertation on freedom and responsibility" },
      { label: "Thinker explainer", prompt: "Explain Descartes\' method of doubt for the Bac" },
      { label: "Argument coach", prompt: "Coach me through building a philosophical argument on justice" },
    ],
  },
];

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

  const handleActionClick = (prompt: string) => {
    setMessage(prompt);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
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

      {/* Hero / composer / topic-suggestion column.
          - On mobile we anchor to the top of the scroll container so the
            entire hero, composer, and suggestion cards are reachable
            without any of them being pushed below the fold by
            justify-center.
          - From sm and up there's plenty of viewport height, so we
            re-enable vertical centering for the classic ChatGPT-style
            empty-state layout. */}
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-start gap-6 px-4 pb-10 pt-6 text-center sm:max-w-3xl sm:justify-center sm:gap-10 sm:px-6 sm:py-10 lg:px-8">
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

        {/* Topic Suggestions — redesigned to match landing-page vibe */}
        <div className="w-full text-left">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Explore topics
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {topics.map((topic, idx) => {
              const Icon = topic.icon;
              return (
                <motion.div
                  key={topic.title}
                  initial={{ opacity: 0, filter: "blur(8px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  transition={{ duration: 0.4, delay: 0.1 * idx }}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border border-border/60 transition-colors duration-200",
                    "hover:border-primary/30",
                  )}
                >
                  {/* Gradient backdrop + dot grid (landing-page pattern) */}
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60",
                      topic.gradient,
                    )}
                  />
                  <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:16px_16px] opacity-30" />

                  {/* Ghost icon */}
                  <Icon className="pointer-events-none absolute -right-4 -top-4 size-28 text-foreground/[0.04] transition-transform duration-500 group-hover:scale-110 sm:size-32" />

                  {/* Content */}
                  <div className="relative flex flex-col gap-3 p-4 sm:p-5">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/80 backdrop-blur",
                        )}
                      >
                        <Icon className={cn("h-4 w-4", topic.accentColor)} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {topic.title}
                        </p>
                      </div>
                    </div>

                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {topic.description}
                    </p>

                    {/* Quick-action chips */}
                    <div className="flex flex-wrap gap-1.5">
                      {topic.actions.map((action) => (
                        <button
                          key={action.label}
                          type="button"
                          onClick={() => handleActionClick(action.prompt)}
                          disabled={isLoading}
                          className={cn(
                            "group/chip inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur transition-colors",
                            "hover:border-primary/40 hover:text-primary",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                          )}
                        >
                          {action.label}
                          <ArrowRight className="h-3 w-3 opacity-0 transition-all group-hover/chip:translate-x-0.5 group-hover/chip:opacity-100" />
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
