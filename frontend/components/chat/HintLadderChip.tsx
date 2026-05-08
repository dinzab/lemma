"use client";

import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  Eye,
  Footprints,
  ListOrdered,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";

import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";

export type LemmaHintLadderToolPart = DynamicToolUIPart | ToolUIPart;

interface HintLadderChipProps {
  part: LemmaHintLadderToolPart;
}

/**
 * Inline render block A1 — *Hint Ladder*.
 *
 * Renders the agent's structured 4-rung scaffold for problem-shaped
 * help requests as a stacked accordion. The student opens rungs in
 * order at their own pace; rung 4 (the full solution) stays clickable
 * but is visually de-emphasised so they're nudged to try the smaller
 * hints first. Once they've opened ≥2 of the upper rungs, the dimming
 * lifts as a small "you've earned it" affordance for strong students.
 *
 * This is the single highest-leverage pedagogical move in the catalog
 * — ChatGPT can't do this, it dumps the full answer. The Hint Ladder
 * forces the student to do as much of the thinking as they can before
 * peeking, which is the only setup that actually produces learning.
 *
 * Two intentional behaviours mirror the other Teacher Protocol chips:
 *
 * 1. We render NOTHING while the tool is still streaming (input not
 *    yet fully available) — there's no ladder to show yet and a
 *    skeleton would be more noise than signal.
 * 2. We render NOTHING when any of the four rungs is missing or
 *    empty — emitting an incomplete ladder defeats the purpose, so
 *    we'd rather collapse to nothing and let the assistant's prose
 *    speak instead.
 *
 * Because this is an `emit_*` tool (the agent authors the rungs in
 * the input payload itself), we read from `part.input`, not
 * `part.output` — the output is just a server-side echo.
 */
export function HintLadderChip({ part }: HintLadderChipProps) {
  const ladder = extractLadder(part);
  const [openedRungs, setOpenedRungs] = useState<Set<number>>(() => new Set());

  if (!ladder) return null;

  const upperRungsOpened = [0, 1, 2].filter((i) => openedRungs.has(i)).length;
  const fullSolutionEarned = upperRungsOpened >= 2 || openedRungs.has(3);

  const toggleRung = (idx: number) => {
    setOpenedRungs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const rungs: RungSpec[] = [
    {
      label: "Indice léger",
      sublabel: "un tout petit pas dans la bonne direction",
      icon: <Sparkles className="size-3.5" />,
      content: ladder.tiny_nudge,
      dimmed: false,
    },
    {
      label: "La technique",
      sublabel: "le nom de la méthode à utiliser",
      icon: <Wrench className="size-3.5" />,
      content: ladder.technique,
      dimmed: false,
    },
    {
      label: "Premier pas",
      sublabel: "la première ligne du raisonnement",
      icon: <Footprints className="size-3.5" />,
      content: ladder.first_move,
      dimmed: false,
    },
    {
      label: "Solution complète",
      sublabel: fullSolutionEarned
        ? "la résolution complète"
        : "essaie d'abord les indices ci-dessus",
      icon: <Eye className="size-3.5" />,
      content: ladder.full_solution,
      dimmed: !fullSolutionEarned,
    },
  ];

  return (
    <aside
      aria-label="Hint Ladder"
      className={cn(
        "my-3 w-full rounded-xl border border-chart-2/25 bg-chart-2/5",
        "px-4 py-3 text-sm text-foreground shadow-sm",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-chart-2/10 ring-1 ring-chart-2/25"
        >
          <ListOrdered className="size-3.5 text-chart-2" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-chart-2/90">
            Indices progressifs
          </div>

          {ladder.problem_summary && (
            <div className="mt-0.5 text-[13px] font-medium text-foreground">
              {ladder.problem_summary}
            </div>
          )}

          <ol className="mt-2 flex flex-col gap-1.5">
            {rungs.map((rung, idx) => {
              const isOpen = openedRungs.has(idx);
              return (
                <li key={idx}>
                  <HintRung
                    index={idx}
                    rung={rung}
                    isOpen={isOpen}
                    onToggle={() => toggleRung(idx)}
                  />
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </aside>
  );
}

interface RungSpec {
  label: string;
  sublabel: string;
  icon: ReactNode;
  content: string;
  dimmed: boolean;
}

interface HintRungProps {
  index: number;
  rung: RungSpec;
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * Individual rung in the Hint Ladder. Renders as a pill-style header
 * + a collapsible body. The dimmed flag (rung 4 before earning) drops
 * the opacity and adds a tooltip-style title attribute so the student
 * sees a gentle "try the smaller hints first" nudge on hover, but the
 * button stays fully clickable — strong students who already know the
 * technique can skip ahead.
 */
function HintRung({ index, rung, isOpen, onToggle }: HintRungProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-chart-2/15 bg-card/60 transition-opacity",
        rung.dimmed && !isOpen && "opacity-60 hover:opacity-90",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        title={
          rung.dimmed
            ? "Essaie les indices plus légers d'abord — c'est là qu'est l'apprentissage."
            : undefined
        }
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-2/40 rounded-lg",
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-chart-2/10 text-chart-2">
          <span aria-hidden>{rung.icon}</span>
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Étape {index + 1}
          </span>
          <span className="block text-[13px] font-medium leading-snug text-foreground">
            {rung.label}
          </span>
          {!isOpen && (
            <span className="block text-[12px] leading-snug text-muted-foreground">
              {rung.sublabel}
            </span>
          )}
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
        <div className="border-t border-chart-2/15 px-3 py-2.5 text-[13px] leading-relaxed text-foreground/90">
          <MessageResponse>{rung.content}</MessageResponse>
        </div>
      )}
    </div>
  );
}

interface HintLadderPayload {
  problem_summary?: string;
  tiny_nudge: string;
  technique: string;
  first_move: string;
  full_solution: string;
}

/**
 * Pull the ladder payload off a `tool-emit_hint_ladder` part.
 *
 * Unlike the recall_* tools (which read `output`), `emit_*` tools
 * carry their authored payload as the *input* — the server-side
 * function is a no-op echo. We require all four rungs to be
 * non-empty strings before rendering: an incomplete ladder defeats
 * the gradient-of-help pedagogy and is better suppressed than shown
 * with empty pills.
 */
function extractLadder(part: LemmaHintLadderToolPart): HintLadderPayload | null {
  if (!("input" in part) || part.input === undefined || part.input === null) {
    return null;
  }

  const input = part.input as {
    problem_summary?: unknown;
    rungs?: unknown;
  };

  const rungs = input.rungs;
  if (!rungs || typeof rungs !== "object") return null;

  const r = rungs as Record<string, unknown>;
  const tiny_nudge = nonEmptyString(r.tiny_nudge);
  const technique = nonEmptyString(r.technique);
  const first_move = nonEmptyString(r.first_move);
  const full_solution = nonEmptyString(r.full_solution);

  if (!tiny_nudge || !technique || !first_move || !full_solution) {
    return null;
  }

  return {
    problem_summary: nonEmptyString(input.problem_summary) ?? undefined,
    tiny_nudge,
    technique,
    first_move,
    full_solution,
  };
}

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}
