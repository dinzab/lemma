"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { WorkflowAnimation } from "@/components/landing/workflow-animation";
import {
  TUTOR_CAPABILITY_TABS,
  type TutorCapabilityTab,
} from "@/components/landing/tutor-capability-tabs";
import { cn } from "@/lib/utils";

const ROTATION_MS = 12_000;

interface TutorShowcaseProps {
  /**
   * Called when the user clicks the "Try this prompt" CTA on a tab.
   * The host page typically feeds the prompt into its composer state.
   */
  onPickPrompt: (prompt: string) => void;
  /**
   * Optionally disable interaction (e.g. while the host page is creating a
   * thread). The active tab keeps animating, but the CTA + tab triggers
   * are disabled.
   */
  disabled?: boolean;
  className?: string;
}

/**
 * In-app capability showcase rendered below the composer on `/new`.
 *
 * Visually mirrors the marketing `<FeaturesSection>` (tabs strip + animated
 * `<WorkflowAnimation>` panel + per-tab progress strip), but:
 *
 *   - shares the *same* tab specs via `TUTOR_CAPABILITY_TABS`, so editing one
 *     surface keeps both in lock-step;
 *   - auto-rotates every `ROTATION_MS`; clicking any tab resets the timer
 *     (via the `activeTab` dep on the effect) so students can dwell on a
 *     panel without losing it mid-read;
 *   - adds a "Try this prompt" CTA that prefills the host's composer with a
 *     short, idiomatic example for the active capability.
 */
export function TutorShowcase({ onPickPrompt, disabled, className }: TutorShowcaseProps) {
  const [activeTab, setActiveTab] = React.useState<string>(TUTOR_CAPABILITY_TABS[0].id);

  React.useEffect(() => {
    const interval = setInterval(() => {
      const idx = TUTOR_CAPABILITY_TABS.findIndex((t) => t.id === activeTab);
      const next = TUTOR_CAPABILITY_TABS[(idx + 1) % TUTOR_CAPABILITY_TABS.length];
      setActiveTab(next.id);
    }, ROTATION_MS);
    return () => clearInterval(interval);
  }, [activeTab]);

  const active: TutorCapabilityTab =
    TUTOR_CAPABILITY_TABS.find((t) => t.id === activeTab) ?? TUTOR_CAPABILITY_TABS[0];

  const handleTryPrompt = () => {
    if (disabled) return;
    onPickPrompt(active.prefillPrompt);
  };

  return (
    <section
      aria-label="What I can help with"
      className={cn("flex flex-col", className)}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          What I can help with
        </p>
        <span className="text-[11px] text-muted-foreground">
          {TUTOR_CAPABILITY_TABS.findIndex((t) => t.id === activeTab) + 1} /{" "}
          {TUTOR_CAPABILITY_TABS.length}
        </span>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        {/* Tabs strip */}
        <div className="overflow-hidden rounded-t-xl border border-b-0">
          <TabsList className="no-scrollbar w-full justify-start overflow-x-auto rounded-none bg-transparent p-0">
            {TUTOR_CAPABILITY_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.id === activeTab;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  disabled={disabled}
                  className={cn(
                    "relative h-12 flex-1 shrink-0 overflow-hidden rounded-none border-x border-t-0 border-b-0 px-2 py-2 text-xs first:border-l-0 last:border-r-0",
                    "data-[state=active]:bg-muted/60",
                  )}
                >
                  <Icon className="mr-1.5 size-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                  {isActive && (
                    <motion.div
                      key={`tab-progress-${tab.id}`}
                      className="absolute inset-x-0 bottom-0 left-0 h-0.5 bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: "100%" }}
                      transition={{ duration: ROTATION_MS / 1000, ease: "linear" }}
                    />
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {/* Panel */}
        <div
          className="relative overflow-hidden rounded-b-xl border bg-background/50"
          style={{
            backgroundImage:
              "radial-gradient(circle, var(--border) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        >
          {/* CTA pinned to top-right; sits above the animation */}
          <div className="absolute right-3 top-3 z-20 flex items-center gap-2 sm:right-4 sm:top-4">
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={handleTryPrompt}
              disabled={disabled}
              className="group h-8 gap-1.5 rounded-full px-3 text-xs shadow-md sm:h-9 sm:text-sm"
            >
              <span>Try this prompt</span>
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </div>

          <div className="relative flex h-[460px] items-center justify-center p-4 sm:p-6 md:h-[600px] lg:p-8">
            <AnimatePresence mode="wait">
              <TabsContent
                key={active.id}
                value={active.id}
                forceMount
                className="mt-0 flex h-full w-full items-center justify-center"
              >
                <motion.div
                  key={active.id}
                  initial={{ opacity: 0, filter: "blur(8px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, filter: "blur(8px)" }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="relative flex h-full w-full max-w-4xl items-center justify-center"
                >
                  <WorkflowAnimation spec={active.spec} />
                </motion.div>
              </TabsContent>
            </AnimatePresence>
          </div>
        </div>
      </Tabs>
    </section>
  );
}
