"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";

import { WorkflowCard } from "@/components/landing/workflow-animation";
import type { TutorCapabilityTab } from "@/components/landing/tutor-capability-tabs";
import { cn } from "@/lib/utils";

interface CapabilityPreviewTileProps {
  capability: TutorCapabilityTab;
  className?: string;
}

/**
 * Compact "what this capability produces" tile shown next to the composer on
 * `/new` when a capability chip is active. Renders the active capability's
 * output card from `TUTOR_CAPABILITY_TABS` — same building block the marketing
 * `<WorkflowAnimation>` uses, so the two surfaces stay visually in sync.
 *
 * Animations:
 *   - The whole tile cross-fades when the active capability changes (keyed on
 *     `capability.id`).
 *   - The inner card uses its native `WorkflowCard` reveal (opacity + y + scale).
 */
export function CapabilityPreviewTile({
  capability,
  className,
}: CapabilityPreviewTileProps) {
  const output = capability.spec.output;

  return (
    <div className={cn("relative w-[18rem]", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-primary/10 via-transparent to-secondary/10 blur-2xl"
      />
      <AnimatePresence mode="wait">
        <motion.div
          key={capability.id}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="flex flex-col items-start pt-6"
        >
          {/* The WorkflowCard renders its own "output" tab label
              `absolute -top-6 left-0`. The wrapper above adds `pt-6` so the
              tab sits cleanly inside the tile's gradient halo without
              clipping the outer column. */}
          <WorkflowCard data={output} type="output" delay={0} className="w-full" />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
