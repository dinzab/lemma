"use client";

import { useState } from "react";
import { ChevronDown, ScrollText, Lock, BookOpen } from "lucide-react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";

import { cn } from "@/lib/utils";
import { FigureThumb } from "@/components/chat/FigureThumb";
import { MessageResponse } from "@/components/ai-elements/message";

export type LemmaGetQuestionPairToolPart = DynamicToolUIPart | ToolUIPart;

interface QuestionCardProps {
  part: LemmaGetQuestionPairToolPart;
}

interface FigureEntry {
  label: string;
  caption: string;
  url: string | null;
}

interface QuestionPairPayload {
  pair_id?: string | null;
  matiere?: string | null;
  chapter?: string | null;
  exam?: string | null;
  exam_id?: string | null;
  exercise_id_global?: string | null;
  year?: number | string | null;
  session?: string | null;
  track?: string | null;
  exercise_number?: number | string | null;
  question_number?: string | number | null;
  difficulty?: string | null;
  bloom_level?: string | null;
  question_text?: string | null;
  answer_text?: string | null;
  has_figure_enonce?: boolean | null;
  has_figure_corrige?: boolean | null;
  figures?: {
    enonce?: FigureEntry[] | null;
    corrige?: FigureEntry[] | null;
  };
  images?: {
    exercise_enonce?: string | null;
    exercise_corrige?: string | null;
    exam_full_enonce?: string | null;
    exam_full_corrige?: string | null;
  };
}

/**
 * Inline render block for the result of `get_question_pair`.
 *
 * Replaces the raw-JSON dump that `<LemmaToolCall>` would otherwise
 * surface for this tool call. The agent reaches for `get_question_pair`
 * when it has decided to *show* a specific past-paper question to the
 * student — the right surface for that is a structured card with:
 *
 *  1. A bold, scannable header (Bac year / session / matière / track,
 *     exercise number, sub-question number, chapter, difficulty pill)
 *     so the student immediately knows *where* in the corpus they are.
 *  2. The énoncé text rendered through `<MessageResponse>` (Streamdown
 *     + KaTeX + code) so embedded LaTeX, equations, and lists render
 *     properly instead of as flat one-paragraph plain text.
 *  3. Inline énoncé figures from `figures.enonce[]` (or the legacy
 *     stitched `images.exercise_enonce`) — the tool was specifically
 *     designed to surface visual énoncés inline.
 *  4. The corrigé hidden behind a "Voir le corrigé" reveal button —
 *     active-recall pattern shared with `<QuestionAssetsBlock>` and
 *     `<StepwiseSolutionCards>`. Students should always *choose* to
 *     reveal the answer, never get it shoved at them.
 *
 * If the payload doesn't have any énoncé text or figures (e.g. the
 * tool errored or returned a "No question pair found" string), we
 * render `null` and let `<LemmaToolCall>` take over with its raw
 * fallback view.
 */
export function QuestionCard({ part }: QuestionCardProps) {
  const [revealCorrige, setRevealCorrige] = useState(false);

  const payload = extractQuestionPairPayload(part);
  if (!payload) return null;

  const enonceText =
    typeof payload.question_text === "string"
      ? payload.question_text.trim()
      : "";
  const corrigeText =
    typeof payload.answer_text === "string"
      ? payload.answer_text.trim()
      : "";

  const enonceFigures = filterFigures(payload.figures?.enonce);
  const corrigeFigures = filterFigures(payload.figures?.corrige);

  // Fallback to the legacy stitched per-exercise image when the v6
  // per-figure entries are empty but the older payload signalled a
  // figure exists. Keeps the card useful for ~600 pre-injection pairs
  // that still ship with `images.exercise_enonce` only.
  const fallbackEnonceUrl =
    enonceFigures.length === 0 &&
    typeof payload.images?.exercise_enonce === "string" &&
    (payload.has_figure_enonce === true ||
      payload.has_figure_enonce === undefined)
      ? payload.images.exercise_enonce
      : null;
  const fallbackCorrigeUrl =
    corrigeFigures.length === 0 &&
    typeof payload.images?.exercise_corrige === "string" &&
    (payload.has_figure_corrige === true ||
      payload.has_figure_corrige === undefined)
      ? payload.images.exercise_corrige
      : null;

  const hasAnyContent =
    enonceText.length > 0 ||
    enonceFigures.length > 0 ||
    fallbackEnonceUrl !== null ||
    corrigeText.length > 0 ||
    corrigeFigures.length > 0 ||
    fallbackCorrigeUrl !== null;

  if (!hasAnyContent) return null;

  const examLine = formatExamLine(payload);
  const exerciseLine = formatExerciseLine(payload);
  const figureAlt = formatFigureAlt(payload);
  const difficultyLabel = formatDifficultyLabel(payload.difficulty);
  const corrigeAvailable =
    corrigeText.length > 0 ||
    corrigeFigures.length > 0 ||
    fallbackCorrigeUrl !== null;

  return (
    <aside
      aria-label="Question card"
      className={cn(
        "my-3 w-full overflow-hidden rounded-2xl border border-secondary/40 bg-secondary/5",
        "shadow-sm",
      )}
    >
      {/* Header strip — metadata, scannable at a glance. */}
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary/20 ring-1 ring-secondary/40"
        >
          <ScrollText className="size-3.5 text-secondary" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
            <span>Passage du BAC</span>
            {examLine && (
              <span className="rounded-full bg-secondary/20 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-foreground">
                {examLine}
              </span>
            )}
            {difficultyLabel && (
              <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
                {difficultyLabel}
              </span>
            )}
          </div>

          {exerciseLine && (
            <div className="mt-0.5 text-[14px] font-semibold text-foreground">
              {exerciseLine}
            </div>
          )}

          {payload.chapter && (
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {payload.chapter}
            </p>
          )}
        </div>
      </div>

      {/* Énoncé section. */}
      <div className="border-t border-secondary/20 bg-background/60 px-4 py-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-secondary">
          <BookOpen className="size-3" aria-hidden />
          Énoncé
        </div>

        {enonceText.length > 0 && (
          <div className="text-[14px] leading-relaxed text-foreground">
            <MessageResponse parseIncompleteMarkdown={false}>
              {enonceText}
            </MessageResponse>
          </div>
        )}

        {enonceFigures.length > 0 && (
          <div
            className={cn("flex flex-wrap gap-2", enonceText.length > 0 && "mt-3")}
            aria-label="Figures de l'énoncé"
          >
            {enonceFigures.map((fig, idx) => (
              <FigureThumb
                key={`enonce-${fig.label}-${idx}`}
                url={fig.url ?? null}
                alt={`${figureAlt} · ${fig.label}`}
                caption={fig.caption}
                size="md"
              />
            ))}
          </div>
        )}

        {enonceFigures.length === 0 && fallbackEnonceUrl && (
          <div className={cn(enonceText.length > 0 && "mt-3")}>
            <FigureThumb
              url={fallbackEnonceUrl}
              alt={`${figureAlt} — énoncé`}
              size="md"
            />
          </div>
        )}
      </div>

      {/* Corrigé section — gated behind active-recall reveal. */}
      {corrigeAvailable && (
        <div className="border-t border-secondary/20 px-4 py-3">
          {!revealCorrige ? (
            <button
              type="button"
              onClick={() => setRevealCorrige(true)}
              className={cn(
                "group inline-flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-secondary/50 bg-secondary/10 px-3 py-2 text-[13px] font-medium text-foreground transition-colors",
                "hover:border-secondary/70 hover:bg-secondary/20 hover:text-secondary",
              )}
              aria-expanded={false}
            >
              <span className="inline-flex items-center gap-2">
                <Lock className="size-3.5 text-secondary" aria-hidden />
                Voir le corrigé
              </span>
              <span className="text-[11px] font-normal text-muted-foreground">
                Essaie d&apos;abord, puis révèle
              </span>
            </button>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-2 text-[10.5px] font-semibold uppercase tracking-wider text-secondary">
                <span className="inline-flex items-center gap-1.5">
                  <BookOpen className="size-3" aria-hidden />
                  Corrigé
                </span>
                <button
                  type="button"
                  onClick={() => setRevealCorrige(false)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium normal-case tracking-normal text-muted-foreground hover:text-foreground"
                  aria-expanded
                >
                  Masquer
                  <ChevronDown className="size-3 rotate-180" aria-hidden />
                </button>
              </div>

              {corrigeText.length > 0 && (
                <div className="text-[14px] leading-relaxed text-foreground">
                  <MessageResponse parseIncompleteMarkdown={false}>
                    {corrigeText}
                  </MessageResponse>
                </div>
              )}

              {corrigeFigures.length > 0 && (
                <div
                  className={cn(
                    "flex flex-wrap gap-2",
                    corrigeText.length > 0 && "mt-3",
                  )}
                  aria-label="Figures du corrigé"
                >
                  {corrigeFigures.map((fig, idx) => (
                    <FigureThumb
                      key={`corrige-${fig.label}-${idx}`}
                      url={fig.url ?? null}
                      alt={`${figureAlt} · ${fig.label}`}
                      caption={fig.caption}
                      size="md"
                    />
                  ))}
                </div>
              )}

              {corrigeFigures.length === 0 && fallbackCorrigeUrl && (
                <div className={cn(corrigeText.length > 0 && "mt-3")}>
                  <FigureThumb
                    url={fallbackCorrigeUrl}
                    alt={`${figureAlt} — corrigé`}
                    size="md"
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Footer — pair_id citation, deliberately small. */}
      {payload.pair_id && (
        <div className="border-t border-secondary/20 bg-secondary/5 px-4 py-1.5">
          <p className="font-mono text-[10.5px] text-muted-foreground/80">
            {payload.pair_id}
          </p>
        </div>
      )}
    </aside>
  );
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

function extractQuestionPairPayload(
  part: LemmaGetQuestionPairToolPart,
): QuestionPairPayload | null {
  if (!("output" in part) || part.output === undefined || part.output === null) {
    return null;
  }
  const parsed = parseOutput(part.output);
  if (!parsed || typeof parsed !== "object") return null;
  return parsed as QuestionPairPayload;
}

/**
 * Quick check used by `<LemmaConversation>` to decide whether to
 * render the structured card or fall through to the generic tool chip
 * (e.g. for error strings like `"No question pair found for pair_id=…"`
 * or while the tool is still streaming).
 */
export function canRenderAsQuestionCard(
  part: LemmaGetQuestionPairToolPart,
): boolean {
  const payload = extractQuestionPairPayload(part);
  if (!payload) return false;
  const enonceText =
    typeof payload.question_text === "string"
      ? payload.question_text.trim()
      : "";
  if (enonceText.length > 0) return true;
  const enonceFigures = filterFigures(payload.figures?.enonce);
  if (enonceFigures.length > 0) return true;
  if (
    typeof payload.images?.exercise_enonce === "string" &&
    payload.images.exercise_enonce.length > 0
  ) {
    return true;
  }
  const corrigeText =
    typeof payload.answer_text === "string"
      ? payload.answer_text.trim()
      : "";
  if (corrigeText.length > 0) return true;
  const corrigeFigures = filterFigures(payload.figures?.corrige);
  if (corrigeFigures.length > 0) return true;
  if (
    typeof payload.images?.exercise_corrige === "string" &&
    payload.images.exercise_corrige.length > 0
  ) {
    return true;
  }
  return false;
}

function filterFigures(
  figures: FigureEntry[] | null | undefined,
): FigureEntry[] {
  if (!Array.isArray(figures)) return [];
  return figures.filter(
    (f) => typeof f.url === "string" && f.url.length > 0,
  );
}

function formatExamLine(payload: QuestionPairPayload): string {
  const parts: string[] = [];
  if (payload.year !== null && payload.year !== undefined) {
    parts.push(`BAC ${payload.year}`);
  }
  if (typeof payload.session === "string" && payload.session.trim()) {
    parts.push(capitalise(payload.session));
  }
  const matiere = stringField(payload.matiere);
  if (matiere) parts.push(capitalise(matiere));
  if (typeof payload.track === "string" && payload.track.trim()) {
    parts.push(`${capitalise(payload.track)} track`);
  }
  return parts.join(" · ");
}

function formatExerciseLine(payload: QuestionPairPayload): string | null {
  const fragments: string[] = [];
  if (
    payload.exercise_number !== null &&
    payload.exercise_number !== undefined &&
    payload.exercise_number !== ""
  ) {
    fragments.push(`Exercice ${payload.exercise_number}`);
  }
  if (
    payload.question_number !== null &&
    payload.question_number !== undefined &&
    payload.question_number !== ""
  ) {
    fragments.push(`Question ${payload.question_number}`);
  }
  return fragments.length ? fragments.join(" — ") : null;
}

function formatFigureAlt(payload: QuestionPairPayload): string {
  const parts: string[] = [];
  if (payload.year !== null && payload.year !== undefined) {
    parts.push(`Bac ${payload.year}`);
  }
  if (typeof payload.matiere === "string") parts.push(payload.matiere);
  if (
    payload.exercise_number !== null &&
    payload.exercise_number !== undefined &&
    payload.exercise_number !== ""
  ) {
    parts.push(`exercice ${payload.exercise_number}`);
  }
  return parts.length > 0 ? parts.join(" ") : "Figure";
}

function capitalise(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Render the difficulty payload as a readable pill label.
 *
 * The corpus's `difficulty` field is sometimes a numeric scale (1–5)
 * and sometimes a string token (“facile” / “moyenne” / “difficile”).
 * A bare “3” in the header strip is meaningless to a student, so we
 * prefix numeric values with “Difficulté …” (assumed `/5` per the
 * corpus pipeline) and capitalise string values verbatim.
 *
 * Returns `null` when the field is empty or unrecognised so the pill
 * collapses entirely.
 */
function formatDifficultyLabel(
  difficulty: string | null | undefined,
): string | null {
  if (difficulty === null || difficulty === undefined) return null;
  const raw = String(difficulty).trim();
  if (raw.length === 0) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) return `Difficulté ${raw}/5`;
  return capitalise(raw);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
