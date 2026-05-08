"use client";

import { useState } from "react";
import { ChevronDown, Compass } from "lucide-react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";

import { cn } from "@/lib/utils";

export type LemmaPatternToolPart = DynamicToolUIPart | ToolUIPart;

interface ThinkingPatternChipProps {
  part: LemmaPatternToolPart;
}

/**
 * Inline render block A11 — *Comment penser à ça*.
 *
 * Renders the canonical thinking-frame for a recurring BAC exercise
 * genre as a pinned card at the top of the assistant's turn (genre +
 * 3-step recipe + typical trap). This is the direct UI surface for
 * steps 2 and 3 of the Teacher Protocol — the agent pulls a curated
 * recipe from the Pattern Atlas BEFORE solving anything, and the
 * student walks away knowing how to *recognise the genre next time*.
 *
 * Two intentional behaviours mirror the A12 anchor chip:
 *
 * 1. We render NOTHING when the tool returned `covered: false` — the
 *    atlas doesn't have a pattern for this genre and the agent is
 *    instructed not to fabricate one. A blank space is the correct
 *    "honest" UI in that case.
 * 2. We render NOTHING while the tool is still streaming
 *    (`input-streaming` / `input-available`) — there's no recipe to
 *    show yet and a skeleton would be more noise than signal.
 *
 * "Voir plus" expands typical exam framings and variations so the
 * student can recognise the genre across more shapes than the canonical
 * one. Collapsed by default to keep the card tight.
 */
export function ThinkingPatternChip({ part }: ThinkingPatternChipProps) {
  const [expanded, setExpanded] = useState(false);
  const pattern = extractPattern(part);

  if (!pattern) return null;

  const hasMore =
    (pattern.typical_framings?.length ?? 0) > 0 ||
    (pattern.variations?.length ?? 0) > 0;

  return (
    <aside
      aria-label="Comment penser à ça"
      className={cn(
        "my-3 w-full rounded-xl border border-chart-3/25 bg-chart-3/5",
        "px-4 py-3 text-sm text-foreground shadow-sm",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-chart-3/10 ring-1 ring-chart-3/25"
        >
          <Compass className="size-3.5 text-chart-3" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-chart-3/90">
            Comment penser à ça
          </div>

          <div className="mt-0.5 text-[13px] font-medium text-foreground">
            <span className="text-muted-foreground">Genre :</span>{" "}
            {pattern.genre}
          </div>

          {pattern.recipe?.length > 0 && (
            <div className="mt-2">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                Recette
              </div>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-foreground/90 marker:text-chart-3/80 marker:font-semibold">
                {pattern.recipe.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          {pattern.trap && (
            <div className="mt-2 rounded-md border border-amber-300/30 bg-amber-100/30 px-2.5 py-1.5 dark:bg-amber-500/10">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Piège classique
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-foreground/90">
                {pattern.trap}
              </p>
            </div>
          )}

          {hasMore && (
            <>
              {expanded && (
                <div className="mt-3 space-y-3">
                  {(pattern.typical_framings?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Comment le BAC le pose
                      </div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] leading-relaxed text-foreground/85 marker:text-chart-3/60">
                        {pattern.typical_framings!.map((framing, idx) => (
                          <li key={idx}>{framing}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {(pattern.variations?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Variations
                      </div>
                      <ul className="mt-1 space-y-1 text-[13px] leading-relaxed text-foreground/85">
                        {pattern.variations!.map((variation, idx) => (
                          <li key={idx} className="flex flex-col">
                            <span className="font-medium text-foreground">
                              {variation.label}
                            </span>
                            <span className="text-foreground/80">
                              {variation.delta}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-chart-3 hover:underline focus:outline-none focus-visible:underline"
              >
                {expanded ? "Réduire" : "Voir plus"}
                <ChevronDown
                  className={cn(
                    "size-3 transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

interface PatternPayload {
  id?: string;
  topic_label?: string;
  matiere?: string[];
  frequency_in_bac?: number;
  genre: string;
  recipe: string[];
  trap?: string;
  typical_framings?: string[];
  variations?: Array<{ label: string; delta: string }>;
}

interface RecallPatternOutput {
  covered: boolean;
  pattern?: PatternPayload;
  concept_query?: string;
}

/**
 * Pull the pattern object out of a `tool-recall_pattern` part. The
 * backend returns a JSON-stringified payload, but `ai`'s `tool-*` parts
 * sometimes surface that as either a parsed object or the raw string —
 * handle both shapes defensively so we never crash a chat render
 * because a tool changed its serialization.
 */
function extractPattern(part: LemmaPatternToolPart): PatternPayload | null {
  if (
    !("output" in part) ||
    part.output === undefined ||
    part.output === null
  ) {
    return null;
  }

  const parsed = parseOutput(part.output);
  if (!parsed || typeof parsed !== "object") return null;
  if ((parsed as RecallPatternOutput).covered !== true) return null;

  const pattern = (parsed as RecallPatternOutput).pattern;
  if (
    !pattern ||
    typeof pattern.genre !== "string" ||
    !Array.isArray(pattern.recipe) ||
    pattern.recipe.length === 0
  ) {
    return null;
  }

  return pattern;
}

function parseOutput(output: unknown): unknown {
  if (typeof output === "string") {
    try {
      return JSON.parse(output);
    } catch {
      return null;
    }
  }
  return output;
}
