"use client";

import { type FormEvent, useState } from "react";
import { ImagePlay, Lock } from "lucide-react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";

import { cn } from "@/lib/utils";
import { FigureThumb } from "@/components/chat/FigureThumb";

export type LemmaShowQuestionAssetsToolPart = DynamicToolUIPart | ToolUIPart;

interface QuestionAssetsBlockProps {
  part: LemmaShowQuestionAssetsToolPart;
}

interface QuestionAssetsPayload {
  pair_id?: string;
  exam?: string | null;
  exam_id?: string | null;
  year?: number | string | null;
  session?: string | null;
  matiere?: string | null;
  track?: string | null;
  exercise_number?: number | string | null;
  question_number?: string | number | null;
  chapter?: string | null;
  has_figure_enonce?: boolean;
  has_figure_corrige?: boolean;
  has_any_figure?: boolean;
  default_side?: "enonce" | "corrige" | "both" | "exam_full" | string;
  images?: {
    exercise_enonce?: string | null;
    exercise_corrige?: string | null;
    exam_full_enonce?: string | null;
    exam_full_corrige?: string | null;
  };
  /**
   * Per-figure entries surfaced by the v6 backend after the May 9
   * figures injection. When at least one side has entries, the panel
   * prefers them over the legacy single stitched image because (a)
   * each entry has its own click-to-zoom and caption, and (b) some
   * exercises have 4–6 figures that get washed together in the
   * stitch.
   */
  figures?: {
    enonce?: AssetFigureEntry[] | null;
    corrige?: AssetFigureEntry[] | null;
  };
}

interface AssetFigureEntry {
  label: string;
  caption: string;
  url: string | null;
}

type TabKey = "enonce" | "corrige" | "exam_full";

interface TabDef {
  key: TabKey;
  label: string;
}

/**
 * Inline render block — *Voir l'épreuve*.
 *
 * Triggered by the agent calling `show_question_assets`. Renders a
 * tabbed panel with three views of the same Bac question pair:
 *
 *  1. **Énoncé** (open by default) — the exercise statement as a PNG.
 *  2. **Corrigé** — gated behind a "Reveal" button that mirrors the
 *     `PredictNextGate` active-recall pattern in
 *     `<StepwiseSolutionCards>`. Pedagogical parity: students should
 *     have to choose to reveal an answer, never get it shoved in
 *     their face.
 *  3. **Exam complet** — the full énoncé page (and corrigé page once
 *     revealed) for surrounding-question context.
 *
 * The default tab honours the agent's `side` arg:
 *  - `enonce` (default) → Énoncé
 *  - `corrige`          → Corrigé (still gated; pre-opening just
 *                          defaults the tab so the student doesn't
 *                          have to switch)
 *  - `both`             → Énoncé (the corrigé tab is one click away)
 *  - `exam_full`        → Exam complet
 *
 * We render NOTHING while the tool is still streaming or when the
 * payload contains no images at all (graceful no-op so an empty panel
 * never reaches the student).
 */
export function QuestionAssetsBlock({ part }: QuestionAssetsBlockProps) {
  const payload = extractAssetsPayload(part);
  const initialTab = chooseInitialTab(payload);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab ?? "enonce");
  const [corrigeUnlocked, setCorrigeUnlocked] = useState<boolean>(
    payload?.default_side === "corrige",
  );

  if (!payload) return null;

  const tabs = availableTabs(payload);
  if (tabs.length === 0) return null;

  // Guard against the initial tab being unavailable (e.g. agent
  // passed `side: "corrige"` but the corrigé image is null).
  const currentTab = tabs.some((t) => t.key === activeTab)
    ? activeTab
    : tabs[0].key;

  const header = formatHeader(payload);

  return (
    <aside
      aria-label="Voir l'épreuve"
      data-pair-id={payload.pair_id ?? undefined}
      className={cn(
        "my-3 w-full rounded-xl border border-secondary/40 bg-secondary/5",
        "px-3 py-2.5 sm:px-4 sm:py-3",
        "text-sm text-foreground shadow-sm",
        "scroll-mt-24 transition-shadow",
      )}
    >
      <div className="flex items-start gap-2 sm:gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary/20 ring-1 ring-secondary/40"
        >
          <ImagePlay className="size-3.5 text-secondary" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-secondary">
            <span>Voir l&apos;épreuve</span>
          </div>

          {header.line1 && (
            <div className="mt-0.5 text-[13px] font-medium text-foreground">
              {header.line1}
            </div>
          )}
          {header.line2 && (
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              {header.line2}
            </p>
          )}

          <div
            role="tablist"
            aria-label="Vues de l'épreuve"
            className="mt-3 flex flex-wrap gap-1.5"
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={currentTab === t.key}
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  "rounded-full px-3 py-1 text-[12px] font-medium transition",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/40",
                  currentTab === t.key
                    ? "bg-secondary/25 text-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-3" role="tabpanel">
            {currentTab === "enonce" && (
              <EnonceTab
                figures={pickFigures(payload, "enonce")}
                imageUrl={payload.images?.exercise_enonce ?? null}
                fallbackUrl={payload.images?.exam_full_enonce ?? null}
                alt={formatAlt(payload, "Énoncé")}
              />
            )}
            {currentTab === "corrige" && (
              <CorrigeTab
                figures={pickFigures(payload, "corrige")}
                imageUrl={payload.images?.exercise_corrige ?? null}
                fallbackUrl={payload.images?.exam_full_corrige ?? null}
                alt={formatAlt(payload, "Corrigé")}
                unlocked={corrigeUnlocked}
                onUnlock={() => setCorrigeUnlocked(true)}
              />
            )}
            {currentTab === "exam_full" && (
              <ExamFullTab
                enonceUrl={payload.images?.exam_full_enonce ?? null}
                corrigeUrl={payload.images?.exam_full_corrige ?? null}
                alt={formatAlt(payload, "Exam complet")}
                corrigeUnlocked={corrigeUnlocked}
                onUnlockCorrige={() => setCorrigeUnlocked(true)}
              />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

interface EnonceTabProps {
  figures: AssetFigureEntry[];
  imageUrl: string | null;
  fallbackUrl: string | null;
  alt: string;
}

function EnonceTab({ figures, imageUrl, fallbackUrl, alt }: EnonceTabProps) {
  if (figures.length > 0) {
    return <FigureGrid figures={figures} alt={alt} />;
  }
  const url = imageUrl ?? fallbackUrl;
  if (!url) {
    return (
      <p className="text-[12px] text-muted-foreground">
        Énoncé indisponible pour cet exercice.
      </p>
    );
  }
  return <FigureThumb url={url} alt={alt} size="lg" />;
}

interface CorrigeTabProps {
  figures: AssetFigureEntry[];
  imageUrl: string | null;
  fallbackUrl: string | null;
  alt: string;
  unlocked: boolean;
  onUnlock: () => void;
}

/**
 * Gated corrigé view. We deliberately reuse the visual language of
 * `<PredictNextGate>` (Lock icon, dashed border, Lightbulb-adjacent
 * accent colour) so students recognise it as the same active-recall
 * lock used elsewhere in the app.
 */
function CorrigeTab({
  figures,
  imageUrl,
  fallbackUrl,
  alt,
  unlocked,
  onUnlock,
}: CorrigeTabProps) {
  const url = imageUrl ?? fallbackUrl;
  const [guess, setGuess] = useState("");

  // Either source of corrigé content can be missing on a given pair;
  // we render the gate / unlocked view as long as at least one of
  // them exists. Falling back to the per-figure grid keeps the corrigé
  // tab visible for the matières (svt / technique / economie) where
  // exercise_corrige stitches are not generated.
  const hasContent = figures.length > 0 || !!url;

  if (!hasContent) {
    return (
      <p className="text-[12px] text-muted-foreground">
        Corrigé indisponible pour cet exercice.
      </p>
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onUnlock();
  };

  if (unlocked) {
    if (figures.length > 0) {
      return <FigureGrid figures={figures} alt={alt} />;
    }
    return <FigureThumb url={url!} alt={alt} size="lg" />;
  }

  return (
    <div className="rounded-lg border border-dashed border-chart-1/30 bg-chart-1/5 px-3 py-3">
      <div className="flex items-start gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-chart-1/10 text-chart-1">
          <Lock className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-chart-1/90">
            Corrigé verrouillé
          </div>
          <div className="mt-0.5 text-[13px] font-medium leading-snug text-foreground">
            Avant de regarder, écris ta première étape.
          </div>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            On ne corrige pas — c&apos;est juste pour t&apos;obliger à y
            penser. Tu pourras voir le corrigé juste après.
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
              Révéler le corrigé
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/**
 * Per-figure grid renderer. Used by both the énoncé and corrigé tabs
 * when the v6 payload ships `figures.{enonce,corrige}` entries with
 * captions. Each entry gets its own click-to-zoom thumb (via
 * `FigureThumb`'s lightbox) and a caption strip below it so the
 * student can read what the figure depicts even before clicking.
 *
 * We render the figures as a 1-column → 2-column responsive grid
 * because most past-exam pairs ship 1–3 figures; very rarely 4+. A
 * grid (vs. a horizontal strip) keeps each figure legible without
 * forcing horizontal scroll on mobile.
 */
function FigureGrid({
  figures,
  alt,
}: {
  figures: AssetFigureEntry[];
  alt: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {figures.map((fig, idx) => (
        <figure
          key={`${fig.label}-${idx}`}
          className="flex flex-col gap-1.5"
        >
          <FigureThumb
            url={fig.url ?? null}
            alt={`${alt} · ${fig.label}`}
            caption={fig.caption}
            size="md"
          />
          <figcaption className="text-[12px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground/80">
              {fig.label}
            </span>
            {fig.caption ? ` — ${fig.caption}` : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

interface ExamFullTabProps {
  enonceUrl: string | null;
  corrigeUrl: string | null;
  alt: string;
  corrigeUnlocked: boolean;
  onUnlockCorrige: () => void;
}

function ExamFullTab({
  enonceUrl,
  corrigeUrl,
  alt,
  corrigeUnlocked,
  onUnlockCorrige,
}: ExamFullTabProps) {
  if (!enonceUrl && !corrigeUrl) {
    return (
      <p className="text-[12px] text-muted-foreground">
        Page d&apos;épreuve indisponible.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {enonceUrl && (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Énoncé · page complète
          </div>
          <FigureThumb
            url={enonceUrl}
            alt={`${alt} — énoncé`}
            size="lg"
          />
        </div>
      )}
      {corrigeUrl && (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Corrigé · page complète
          </div>
          {corrigeUnlocked ? (
            <FigureThumb
              url={corrigeUrl}
              alt={`${alt} — corrigé`}
              size="lg"
            />
          ) : (
            <button
              type="button"
              onClick={onUnlockCorrige}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-dashed border-chart-1/30",
                "bg-chart-1/5 px-3 py-2 text-[12px] font-medium text-chart-1",
                "hover:bg-chart-1/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1/40",
              )}
            >
              <Lock className="size-3.5" aria-hidden />
              Révéler le corrigé
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Pull and parse the assets payload off a `tool-show_question_assets`
 * part. Reads from `output` (the server's response carries the URLs)
 * — `input` only has `pair_id`/`side` and isn't useful to render.
 *
 * We tolerate three failure modes by returning null (which makes the
 * component render nothing):
 *   1. The tool is still streaming (no `output` yet).
 *   2. The output is a plain error string (e.g. "No question pair
 *      found for pair_id=…").
 *   3. The payload has no images at all (every `images.*` is null /
 *      undefined). An empty panel is worse than no panel.
 */
function extractAssetsPayload(
  part: LemmaShowQuestionAssetsToolPart,
): QuestionAssetsPayload | null {
  if (!("output" in part) || part.output === undefined || part.output === null) {
    return null;
  }
  const parsed = parseOutput(part.output);
  if (!parsed || typeof parsed !== "object") return null;

  const payload = parsed as QuestionAssetsPayload;
  const images = payload.images ?? {};
  const anyImage =
    typeof images.exercise_enonce === "string" ||
    typeof images.exercise_corrige === "string" ||
    typeof images.exam_full_enonce === "string" ||
    typeof images.exam_full_corrige === "string";
  // svt / technique / economie matières don't have stitched per-
  // exercise images at all but DO have per-figure entries in the new
  // payload — render the panel for them too as long as we have
  // figures to show.
  const anyFigure =
    pickFigures(payload, "enonce").length > 0 ||
    pickFigures(payload, "corrige").length > 0;
  if (!anyImage && !anyFigure) return null;
  return payload;
}

/**
 * Side-aware figure picker. Returns only the entries with a
 * non-empty `url` — silently dropping malformed entries from the
 * payload — so the tabs/grid logic can lean on `length > 0` without
 * worrying about rendering broken image slots.
 */
function pickFigures(
  payload: QuestionAssetsPayload,
  side: "enonce" | "corrige",
): AssetFigureEntry[] {
  const arr = payload.figures?.[side];
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (f): f is AssetFigureEntry =>
      !!f && typeof f.url === "string" && f.url.length > 0,
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

function availableTabs(payload: QuestionAssetsPayload): TabDef[] {
  const tabs: TabDef[] = [];
  const images = payload.images ?? {};
  const enonceFigures = pickFigures(payload, "enonce");
  const corrigeFigures = pickFigures(payload, "corrige");
  const enonceUrl = images.exercise_enonce ?? images.exam_full_enonce ?? null;
  if (enonceUrl || enonceFigures.length > 0) {
    tabs.push({ key: "enonce", label: "Énoncé" });
  }
  const corrigeUrl =
    images.exercise_corrige ?? images.exam_full_corrige ?? null;
  if (corrigeUrl || corrigeFigures.length > 0) {
    tabs.push({ key: "corrige", label: "Corrigé" });
  }
  if (images.exam_full_enonce || images.exam_full_corrige) {
    tabs.push({ key: "exam_full", label: "Exam complet" });
  }
  return tabs;
}

function chooseInitialTab(
  payload: QuestionAssetsPayload | null,
): TabKey | null {
  if (!payload) return null;
  const tabs = availableTabs(payload);
  if (tabs.length === 0) return null;

  const want = payload.default_side;
  if (want === "corrige" && tabs.some((t) => t.key === "corrige")) {
    return "corrige";
  }
  if (want === "exam_full" && tabs.some((t) => t.key === "exam_full")) {
    return "exam_full";
  }
  // "enonce" and "both" both default to the énoncé tab; fall back to
  // the first available if énoncé isn't there.
  if (tabs.some((t) => t.key === "enonce")) return "enonce";
  return tabs[0].key;
}

function formatHeader(payload: QuestionAssetsPayload): {
  line1: string;
  line2: string;
} {
  const line1Parts: string[] = [];
  if (payload.year !== undefined && payload.year !== null) {
    line1Parts.push(`BAC ${payload.year}`);
  }
  if (typeof payload.session === "string" && payload.session.trim()) {
    line1Parts.push(`session ${payload.session}`);
  }
  if (typeof payload.track === "string" && payload.track.trim()) {
    line1Parts.push(payload.track);
  }
  if (typeof payload.matiere === "string" && payload.matiere.trim()) {
    line1Parts.push(payload.matiere);
  }

  const line2Parts: string[] = [];
  if (typeof payload.chapter === "string" && payload.chapter.trim()) {
    line2Parts.push(payload.chapter);
  }
  if (
    payload.exercise_number !== undefined &&
    payload.exercise_number !== null
  ) {
    line2Parts.push(`Exercice ${payload.exercise_number}`);
  }
  if (
    payload.question_number !== undefined &&
    payload.question_number !== null
  ) {
    line2Parts.push(`Q.${payload.question_number}`);
  }

  return {
    line1: line1Parts.join(" · "),
    line2: line2Parts.join(" · "),
  };
}

function formatAlt(payload: QuestionAssetsPayload, kind: string): string {
  const parts: string[] = [kind];
  if (payload.year !== undefined && payload.year !== null) {
    parts.push(`BAC ${payload.year}`);
  }
  if (typeof payload.session === "string" && payload.session.trim()) {
    parts.push(payload.session);
  }
  if (
    payload.exercise_number !== undefined &&
    payload.exercise_number !== null
  ) {
    parts.push(`Exercice ${payload.exercise_number}`);
  }
  return parts.join(" · ");
}
