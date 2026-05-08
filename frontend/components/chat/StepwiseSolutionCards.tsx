"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ListChecks,
  Lightbulb,
  Lock,
} from "lucide-react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";

import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";

export type LemmaSolutionStepsToolPart = DynamicToolUIPart | ToolUIPart;

interface StepwiseSolutionCardsProps {
  part: LemmaSolutionStepsToolPart;
}

/**
 * Inline render block A4 — *Stepwise Solution Cards*.
 *
 * Renders the agent's structured worked solution as a numbered card
 * stack. Every card is folded by default — only the step's title is
 * visible. The student opens cards one at a time instead of scanning
 * a wall of LaTeX. Each expanded card carries the actual working
 * (rendered through Streamdown so LaTeX / code / mermaid all work),
 * the justification (the rule / theorem / observation that licences
 * the move), and an optional ⚠ *Common mistake here* callout for the
 * typical Tunisian-BAC trap.
 *
 * Some cards can flag `predict_next: true`, which hides the *next*
 * card behind a *Predict the next step* gate: the student types
 * what they think the next move is, the next card unlocks. We do not
 * validate the typed answer — the value is in the act of trying. This
 * is the highest-leverage active-recall move available; it converts a
 * passive corrigé into a guided exercise.
 *
 * Two intentional behaviours mirror the other Teacher Protocol chips:
 *
 * 1. We render NOTHING while the tool is still streaming (input not
 *    fully available) — there's no card stack to show yet.
 * 2. We render NOTHING when fewer than two steps are present, or any
 *    step is missing its required fields (title / latex /
 *    justification). A half-built stack is more confusing than no
 *    stack — better to fall through to the assistant's prose.
 *
 * Because this is an `emit_*` tool (the agent authors the cards in
 * the input payload itself), we read from `part.input`, not
 * `part.output` — the output is just a server-side echo.
 */
export function StepwiseSolutionCards({ part }: StepwiseSolutionCardsProps) {
  const stack = useMemo(() => extractStack(part), [part]);
  const [openedSteps, setOpenedSteps] = useState<Set<number>>(
    () => new Set(),
  );
  const [unlockedAfter, setUnlockedAfter] = useState<Set<number>>(
    () => new Set(),
  );

  if (!stack) return null;

  const toggleStep = (idx: number) => {
    setOpenedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const unlockAfter = (idx: number) => {
    setUnlockedAfter((prev) => {
      if (prev.has(idx)) return prev;
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  };

  const isStepVisible = (idx: number) => {
    if (idx === 0) return true;
    const prev = stack.steps[idx - 1];
    if (!prev?.predict_next) return true;
    return unlockedAfter.has(idx - 1);
  };

  return (
    <aside
      aria-label="Stepwise solution"
      className={cn(
        "my-3 w-full rounded-xl border border-chart-1/25 bg-chart-1/5",
        "px-4 py-3 text-sm text-foreground shadow-sm",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-chart-1/10 ring-1 ring-chart-1/25"
        >
          <ListChecks className="size-3.5 text-chart-1" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-chart-1/90">
            Résolution étape par étape
          </div>

          {stack.problem_summary && (
            <div className="mt-0.5 text-[13px] font-medium text-foreground">
              {stack.problem_summary}
            </div>
          )}

          <ol className="mt-2 flex flex-col gap-1.5">
            {stack.steps.map((step, idx) => {
              const visible = isStepVisible(idx);
              const isOpen = openedSteps.has(idx);
              return (
                <li key={idx}>
                  {visible ? (
                    <SolutionStepCard
                      index={idx}
                      step={step}
                      isOpen={isOpen}
                      onToggle={() => toggleStep(idx)}
                    />
                  ) : (
                    <PredictNextGate
                      index={idx}
                      onUnlock={() => unlockAfter(idx - 1)}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </aside>
  );
}

interface SolutionStepCardProps {
  index: number;
  step: SolutionStep;
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * Individual step card. Header is always visible (Étape N · title);
 * the body (LaTeX + justification + optional common-mistake callout)
 * stays folded until clicked. The body renders through MessageResponse
 * so the existing Streamdown / KaTeX pipeline handles math delimiters
 * and code blocks identically to assistant prose.
 */
function SolutionStepCard({
  index,
  step,
  isOpen,
  onToggle,
}: SolutionStepCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-chart-1/15 bg-card/60 transition-colors",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1/40 rounded-lg",
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-chart-1/10 text-[11px] font-semibold text-chart-1">
          {index + 1}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Étape {index + 1}
          </span>
          <span className="block text-[13px] font-medium leading-snug text-foreground">
            {step.title}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div className="border-t border-chart-1/15 px-3 py-2.5 text-[13px] leading-relaxed text-foreground/90">
          <MessageResponse>{step.latex}</MessageResponse>

          <div className="mt-2 rounded-md bg-muted/40 px-2.5 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Pourquoi
            </div>
            <div className="mt-0.5 text-[13px] leading-relaxed text-foreground/90">
              <MessageResponse>{step.justification}</MessageResponse>
            </div>
          </div>

          {step.common_mistake && (
            <div className="mt-2 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
              <AlertTriangle
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
              />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  Piège fréquent
                </div>
                <div className="mt-0.5 text-[13px] leading-relaxed text-foreground/90">
                  <MessageResponse>{step.common_mistake}</MessageResponse>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PredictNextGateProps {
  index: number;
  onUnlock: () => void;
}

/**
 * Active-recall gate. Replaces a hidden step card with a small form
 * that asks the student to type what they think the next move is.
 * We don't validate the answer — the value is purely in the act of
 * trying. Submitting (or pressing the *Reveal* button) calls back
 * into the parent to mark the gate as unlocked, which makes the
 * next card visible (collapsed) in its place.
 */
function PredictNextGate({ index, onUnlock }: PredictNextGateProps) {
  const [guess, setGuess] = useState("");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onUnlock();
  };

  return (
    <div className="rounded-lg border border-dashed border-chart-1/30 bg-chart-1/5 px-3 py-3">
      <div className="flex items-start gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-chart-1/10 text-chart-1">
          <Lightbulb className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-chart-1/90">
            Étape {index + 1} · à toi
          </div>
          <div className="mt-0.5 text-[13px] font-medium leading-snug text-foreground">
            À ton avis, c&apos;est quoi le prochain pas&nbsp;?
          </div>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            Essaie d&apos;écrire ce que tu ferais avant de regarder la suite.
            On ne corrige pas — c&apos;est juste pour t&apos;obliger à y
            penser.
          </p>
          <form
            onSubmit={onSubmit}
            className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <input
              type="text"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              placeholder="Ex&nbsp;: «&nbsp;je dérive l&apos;équation&nbsp;»"
              className={cn(
                "w-full flex-1 rounded-md border border-chart-1/25 bg-background",
                "px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/70",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1/40",
              )}
            />
            <button
              type="submit"
              className={cn(
                "inline-flex shrink-0 items-center justify-center gap-1.5",
                "rounded-md bg-chart-1/15 px-3 py-1.5 text-[12px] font-medium text-chart-1",
                "hover:bg-chart-1/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1/40",
              )}
            >
              <Lock className="size-3.5" aria-hidden />
              Révéler la suite
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

interface SolutionStep {
  title: string;
  latex: string;
  justification: string;
  common_mistake?: string;
  predict_next?: boolean;
}

interface SolutionStackPayload {
  problem_summary?: string;
  steps: SolutionStep[];
}

/**
 * Pull the card-stack payload off a `tool-emit_solution_steps` part.
 *
 * Like {@link extractLadder}, we read from `input` (the agent
 * authors the steps as the tool's input payload) rather than
 * `output` (which is just a server-side echo). We require at least
 * two steps and, for each step, non-empty `title`, `latex`, and
 * `justification`. A stack with one step is a paragraph in
 * disguise; a stack with empty fields renders broken cards. In both
 * cases we'd rather show nothing and let the assistant's prose
 * carry the answer.
 */
function extractStack(
  part: LemmaSolutionStepsToolPart,
): SolutionStackPayload | null {
  if (!("input" in part) || part.input === undefined || part.input === null) {
    return null;
  }

  const input = part.input as {
    problem_summary?: unknown;
    steps?: unknown;
  };

  const rawSteps = input.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length < 2) return null;

  const steps: SolutionStep[] = [];
  for (const raw of rawSteps) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;

    const title = nonEmptyString(r.title);
    const latex = nonEmptyString(r.latex);
    const justification = nonEmptyString(r.justification);
    if (!title || !latex || !justification) return null;

    steps.push({
      title,
      latex,
      justification,
      common_mistake: nonEmptyString(r.common_mistake) ?? undefined,
      predict_next: r.predict_next === true ? true : undefined,
    });
  }

  return {
    problem_summary: nonEmptyString(input.problem_summary) ?? undefined,
    steps,
  };
}

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}
