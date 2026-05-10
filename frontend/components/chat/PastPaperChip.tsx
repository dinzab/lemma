"use client";

import { useState } from "react";
import { ChevronDown, ScrollText } from "lucide-react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";

import { cn } from "@/lib/utils";
import { FigureThumb } from "@/components/chat/FigureThumb";

export type LemmaSearchQuestionsToolPart = DynamicToolUIPart | ToolUIPart;

interface PastPaperChipProps {
  part: LemmaSearchQuestionsToolPart;
}

/**
 * Inline render block A2 — *Passage du BAC*.
 *
 * When the agent calls `search_questions`, render the top-1 match as a
 * soft pinned card showing year + session + chapter + a confidence
 * indicator. Together with the structured `<QuestionCard>` (rendered
 * for `get_question_pair`) and `<QuestionAssetsBlock>` (for
 * `show_question_assets`), this is the canonical past-paper surface:
 * the chip surfaces "this is BAC-aware, not generic prep" without any
 * pedagogical scaffolding bolted on.
 *
 * Three intentional behaviours:
 *
 * 1. We render NOTHING while the tool is still streaming — there's no
 *    payload to show yet, and a skeleton would just be noise.
 * 2. We render NOTHING when the results array is empty. The agent's
 *    prose explains the concept; an empty chip would just confuse.
 * 3. We render NOTHING when the top match's similarity score is below
 *    {@link MIN_SCORE}. False positives are worse than no chip — a
 *    student who sees "BAC 2009 · 12% match" loses trust in everything
 *    around it. The threshold is conservative on purpose; we'd rather
 *    drop a borderline match than over-promise.
 */
export function PastPaperChip({ part }: PastPaperChipProps) {
  const [expanded, setExpanded] = useState(false);
  const top = extractTopMatch(part);

  if (!top) return null;

  const examLine = formatExamLine(top);
  const matchPct =
    typeof top.score === "number"
      ? Math.round(Math.min(Math.max(top.score, 0), 1) * 100)
      : null;
  const exerciseLine = formatExerciseLine(top);
  const hasQuestion =
    typeof top.question_text === "string" && top.question_text.trim().length > 0;
  // v6+ payloads ship per-figure entries on `figures.enonce` (with
  // captions). When present, render the full strip so a search hit
  // with multiple énoncé figures shows all of them, each captioned
  // for hover/screen-reader users. When absent (older payloads), fall
  // back to the single per-exercise stitch via `images.exercise_enonce`,
  // gated by the `figures.enonce`/`has_figure_enonce` truth — see the
  // payload doc on `PaperMatch`.
  const enonceFigures = Array.isArray(top.figures?.enonce)
    ? top.figures!.enonce.filter((f) => typeof f.url === "string" && f.url.length > 0)
    : [];
  const fallbackFigureUrl =
    enonceFigures.length === 0 &&
    (top.has_figure_enonce === true ||
      // Some pre-figures payloads still set has_figure_enonce=true; we
      // also accept the case where no boolean is present but the
      // exercise stitch URL is — strictly better than rendering nothing
      // when the chip is meant to be a passive thumbnail.
      typeof top.images?.exercise_enonce === "string")
      ? top.images?.exercise_enonce ?? null
      : null;
  const figureAlt = formatFigureAlt(top);

  return (
    <aside
      aria-label="Passage du BAC"
      data-pair-id={top.pair_id ?? undefined}
      className={cn(
        "my-3 w-full rounded-xl border border-secondary/40 bg-secondary/5",
        "px-4 py-3 text-sm text-foreground shadow-sm",
        "scroll-mt-24 transition-shadow",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary/20 ring-1 ring-secondary/40"
        >
          <ScrollText className="size-3.5 text-secondary" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
            <span>Passage du BAC</span>
            {matchPct !== null && (
              <span className="rounded-full bg-secondary/20 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-foreground">
                {matchPct}% match
              </span>
            )}
          </div>

          {examLine && (
            <div className="mt-0.5 text-[13px] font-medium text-foreground">
              {examLine}
            </div>
          )}

          {top.chapter && (
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              {top.chapter}
              {exerciseLine ? ` · ${exerciseLine}` : ""}
            </p>
          )}

          {enonceFigures.length > 0 && (
            <div
              className="mt-2 flex flex-wrap gap-1.5"
              aria-label="Figures de l'énoncé"
            >
              {enonceFigures.map((fig, idx) => (
                <FigureThumb
                  key={`${fig.label}-${idx}`}
                  url={fig.url ?? null}
                  alt={`${figureAlt} · ${fig.label}`}
                  caption={fig.caption}
                  size="sm"
                />
              ))}
            </div>
          )}
          {enonceFigures.length === 0 && fallbackFigureUrl && (
            <div className="mt-2">
              <FigureThumb
                url={fallbackFigureUrl}
                alt={figureAlt}
                size="sm"
              />
            </div>
          )}

          {hasQuestion && (
            <>
              {expanded && (
                <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">
                  {top.question_text}
                </p>
              )}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-secondary hover:underline focus:outline-none focus-visible:underline"
              >
                {expanded ? "Réduire" : "Voir la question"}
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

/**
 * Minimum cosine similarity (Qdrant dense score) for a match to be
 * surfaced as a chip. Tuned against the live corpus where dense
 * cosine on this embedding clusters in 0.30–0.50 for relevant matches
 * and dips below 0.30 for off-topic recalls — empirically:
 *
 * | query                                       | top score | top chapter (chosen by rerank) |
 * |---------------------------------------------|-----------|--------------------------------|
 * | "forme exponentielle d'un nombre complexe"  | 0.468     | Nombres complexes ✓            |
 * | "module et argument d'un complexe"          | 0.306     | Nombres complexes ✓            |
 * | "limite d'une suite"                        | 0.322     | Suites numériques ✓            |
 * | "fonction affine"                           | 0.297     | Probabilités ✗ (off-topic)     |
 *
 * 0.30 is the cleanest split between the "correct topic" cluster and
 * the off-topic noise floor. False positives (a chip for the wrong
 * topic) hurt trust more than false negatives (no chip when the
 * corpus genuinely lacks a strong match), so we err toward silence.
 * See component-level comment for rationale.
 */
const MIN_SCORE = 0.3;

interface PaperMatch {
  pair_id?: string;
  matiere?: string;
  chapter?: string;
  exam?: string;
  year?: number;
  session?: "principale" | "controle" | string;
  track?: string;
  exercise_number?: string | number;
  question_number?: string | number;
  question_text?: string;
  score?: number;
  /**
   * v6 boolean flags. The backend recomputes these from the figure
   * arrays so they're never stale, but we still keep them for
   * back-compat with older payloads that arrived through long-lived
   * conversation state.
   */
  has_figure_enonce?: boolean | null;
  has_figure_corrige?: boolean | null;
  images?: {
    exercise_enonce?: string | null;
    exercise_corrige?: string | null;
    exam_full_enonce?: string | null;
    exam_full_corrige?: string | null;
  };
  /**
   * Per-figure entries shipped from the backend's `formatPairForLLM`
   * (one per scanned figure on each side). `caption` is the
   * LLM-generated French description of the figure (truncated for
   * non-`full` callers); `url` is the public R2 URL.
   *
   * The chip prefers this strip over the legacy single-thumbnail
   * fallback because (a) one-figure exercises and ten-figure
   * exercises now look correct, and (b) the captions feed
   * accessibility tooling.
   */
  figures?: {
    enonce?: PaperFigureEntry[] | null;
    corrige?: PaperFigureEntry[] | null;
  };
}

interface PaperFigureEntry {
  label: string;
  caption: string;
  url: string | null;
}

interface SearchQuestionsOutput {
  results?: PaperMatch[];
}

function extractTopMatch(
  part: LemmaSearchQuestionsToolPart,
): PaperMatch | null {
  if (!("output" in part) || part.output === undefined || part.output === null) {
    return null;
  }
  const parsed = parseOutput(part.output);
  if (!parsed || typeof parsed !== "object") return null;

  const results = (parsed as SearchQuestionsOutput).results;
  if (!Array.isArray(results) || results.length === 0) return null;

  const top = results[0];
  if (!top || typeof top !== "object") return null;

  if (typeof top.score === "number" && top.score < MIN_SCORE) {
    return null;
  }
  return top;
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

function formatExamLine(top: PaperMatch): string {
  const parts: string[] = [];
  if (typeof top.year === "number") parts.push(`BAC ${top.year}`);
  if (typeof top.session === "string" && top.session.trim()) {
    parts.push(`session ${top.session}`);
  }
  if (typeof top.track === "string" && top.track.trim()) {
    parts.push(top.track);
  }
  return parts.join(" · ");
}

function formatExerciseLine(top: PaperMatch): string {
  const parts: string[] = [];
  if (top.exercise_number !== undefined && top.exercise_number !== null) {
    parts.push(`Exercice ${top.exercise_number}`);
  }
  if (top.question_number !== undefined && top.question_number !== null) {
    parts.push(`Q.${top.question_number}`);
  }
  return parts.join(" · ");
}

function formatFigureAlt(top: PaperMatch): string {
  const fragments: string[] = ["Énoncé"];
  if (typeof top.year === "number") fragments.push(`BAC ${top.year}`);
  if (typeof top.session === "string" && top.session.trim()) {
    fragments.push(top.session);
  }
  if (top.exercise_number !== undefined && top.exercise_number !== null) {
    fragments.push(`Exercice ${top.exercise_number}`);
  }
  return fragments.join(" · ");
}
