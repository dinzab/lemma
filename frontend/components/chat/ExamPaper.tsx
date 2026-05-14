"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  ScrollText,
  Sparkles,
} from "lucide-react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";

import { MessageResponse } from "@/components/ai-elements/message";
import { buildExamPdfFilename, downloadExamPdf } from "@/lib/exam-pdf";
import { wrapBareLatex } from "@/lib/latex";
import { cn } from "@/lib/utils";

export type LemmaEmitExamToolPart = DynamicToolUIPart | ToolUIPart;

interface ExamPaperProps {
  part: LemmaEmitExamToolPart;
}

/**
 * Inline render block — *Exam Paper*.
 *
 * Renders the agent's structured `emit_exam` payload as a Tunisian
 * BAC-format paper:
 *
 *  - real BAC banner (République Tunisienne / Ministère de
 *    l'Éducation / Direction des Examens et Concours / Examen du
 *    Baccalauréat / Session / Section · Épreuve · Coefficient ·
 *    Durée) when `kind === "full_paper"`;
 *  - numbered exercises with marks in the right margin;
 *  - recursively-nested questions matching the BAC numbering
 *    (1. → a) → i.);
 *  - per-leaf-question *Voir la correction* disclosure, collapsed
 *    by default (Active-Recall Gate pattern — student is forced to
 *    attempt before peeking);
 *  - top toolbar with *Tout afficher / Tout masquer / Télécharger*
 *    buttons. Each download mode (sujet seul / corrigé seul /
 *    sujet + corrigé) builds a per-mode A4 PDF via
 *    `downloadExamPdf` — see `lib/exam-pdf.ts` for the pipeline.
 *    We deliberately *do not* call `window.print()` anymore:
 *    mobile browsers crop the BAC paper at the viewport edge and
 *    the desktop print dialog has fought us for several PRs over
 *    pagination + theme leakage. A real downloadable PDF gives
 *    the student the same paginated, monochrome BAC paper on
 *    every device (and they can hit print on the resulting file
 *    when they actually want a paper copy).
 *
 * Two intentional behaviours mirror the other emit_* chips:
 *
 *  1. We render NOTHING while the tool is still streaming (input
 *     not yet fully shaped) — half-built papers are noise.
 *  2. We render NOTHING when the payload is missing the required
 *     `kind` / `exercises` fields or every exercise has no parts —
 *     a half-filled paper is worse than no paper.
 *
 * Because this is an `emit_*` tool (the agent authors the paper in
 * the input payload itself), we read from `part.input`, not
 * `part.output` — the output is just a server-side echo.
 */
export function ExamPaper({ part }: ExamPaperProps) {
  const paper = extractExam(part);

  // `revealed` is the per-part disclosure state — a set of leaf
  // part IDs whose `Voir la correction` button has been tapped.
  // We default to an empty set (collapsed) so the student is
  // gently nudged to try the question before peeking.
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());

  // Ref to the rendered <aside data-exam-paper> so the download
  // handler can clone it for the off-screen PDF render — see
  // `handleDownload` below.
  const paperRef = useRef<HTMLElement>(null);

  // Per-mode loading state — disables the toolbar buttons while a
  // PDF is being rasterised so the student doesn't queue up
  // multiple renders by tapping repeatedly on a slow phone.
  const [downloadingMode, setDownloadingMode] = useState<
    null | "enonce" | "corrige" | "both"
  >(null);

  // Pre-compute the flat list of leaf-part IDs that *have* a
  // correction. Used by the global *Tout afficher / Tout masquer*
  // toolbar buttons and to suppress those buttons entirely when
  // the paper carries no corrigé.
  const leafIdsWithCorrection = useMemo(() => {
    if (!paper) return [] as string[];
    const out: string[] = [];
    for (const exercise of paper.exercises) {
      collectLeafIdsWithCorrection(exercise.parts, out);
    }
    return out;
  }, [paper]);

  const hasAnyCorrection = leafIdsWithCorrection.length > 0;
  const allRevealed =
    hasAnyCorrection &&
    leafIdsWithCorrection.every((id) => revealed.has(id));

  const toggleRevealed = useCallback((id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const revealAll = useCallback(() => {
    setRevealed(new Set(leafIdsWithCorrection));
  }, [leafIdsWithCorrection]);

  const hideAll = useCallback(() => {
    setRevealed(new Set());
  }, []);

  // Download handler — clones the rendered paper, mutates the
  // clone to reflect the chosen export mode (énoncé / corrigé /
  // both), and hands it off to `downloadExamPdf` which mounts it
  // off-screen, screenshots it with html2canvas-pro, and emits a
  // paginated A4 PDF the student can download.
  //
  // We don't use `window.print()` anymore. The previous flow
  // (clone → top-level portal → body class → window.print →
  // afterprint cleanup) fought for several PRs against mobile
  // browsers that crop at the viewport edge, theme variables
  // bleeding into the cloned DOM, and desktop print dialogs
  // returning from `window.print()` before the portal was
  // captured. A real PDF download is portable, identical on
  // every device, and the student can still hit print on the
  // resulting file when they want a hard copy.
  const handleDownload = useCallback(
    async (mode: "enonce" | "corrige" | "both") => {
      if (typeof window === "undefined") return;
      const node = paperRef.current;
      if (!node) return;
      if (downloadingMode) return;

      // Clone the rendered paper, then mutate the clone so the
      // off-screen render already reflects the requested export
      // mode. Pre-processing the DOM (rather than trying to drive
      // visibility through CSS on the clone) keeps the export
      // robust against any future Tailwind utility / `[hidden]`
      // edge cases — the rasteriser only sees the elements we
      // actually want in the PDF.
      const clone = node.cloneNode(true) as HTMLElement;

      if (mode === "enonce") {
        clone
          .querySelectorAll(".exam-correction-wrapper")
          .forEach((el) => el.remove());
      } else {
        // "corrige" and "both" both need every correction visible,
        // regardless of on-screen reveal state.
        clone
          .querySelectorAll(".exam-correction[hidden]")
          .forEach((el) => el.removeAttribute("hidden"));
        // Drop the disclosure trigger button — the exported paper
        // doesn't need a clickable "Voir la correction" affordance.
        clone
          .querySelectorAll(".exam-correction-trigger")
          .forEach((el) => el.remove());
      }

      if (mode === "corrige") {
        // Drop every prompt (énoncé text + part labels + exercise
        // intro paragraph). Only the corrigé remains.
        clone
          .querySelectorAll(".exam-prompt")
          .forEach((el) => el.remove());
      }

      // Inject the mode heading directly above the exercises so the
      // exported paper carries an explicit "ÉNONCÉ / SUJET + CORRIGÉ
      // / CORRIGÉ" banner — a real Tunisian BAC sujet always has
      // one and it's how the teacher / corrector tells them apart.
      const modeLabel =
        mode === "enonce"
          ? "Énoncé"
          : mode === "corrige"
            ? "Corrigé"
            : "Sujet + corrigé";
      const heading = document.createElement("div");
      heading.className = "exam-print-mode-heading";
      heading.textContent = modeLabel;
      const surface = clone.querySelector(".exam-paper-surface");
      const insertionTarget = surface ?? clone;
      const banner = insertionTarget.querySelector(".exam-banner");
      if (banner && banner.parentNode === insertionTarget) {
        banner.insertAdjacentElement("afterend", heading);
      } else {
        insertionTarget.insertBefore(heading, insertionTarget.firstChild);
      }

      const filename = buildExamPdfFilename(paper?.header, mode);

      setDownloadingMode(mode);
      try {
        await downloadExamPdf({ paperEl: clone, filename });
      } catch (error) {
        // Surface the failure on the console so we get a stack
        // trace in production telemetry. We deliberately don't
        // depend on a toast library here — the toolbar's loading
        // state clears below and the student is free to retry.
        console.error("[ExamPaper] PDF download failed", error);
      } finally {
        setDownloadingMode(null);
      }
    },
    // `paper` is only read for the filename header, and we keep
    // the dep list narrow so React doesn't re-create the handler
    // every time `revealed` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [downloadingMode, paper?.header?.matiere, paper?.header?.section, paper?.header?.year, paper?.header?.session],
  );

  if (!paper) return null;

  const showBanner = paper.kind === "full_paper" && paper.header;

  return (
    <aside
      ref={paperRef}
      aria-label="Exam paper"
      data-exam-paper
      className={cn(
        // Screen styling — the paper sits inside a card so it
        // visually pairs with the other emit_* surfaces, but in
        // print we strip every chrome layer (see globals.css).
        "exam-paper my-3 w-full overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-sm sm:rounded-xl",
      )}
    >
      <ExamToolbar
        hasAnyCorrection={hasAnyCorrection}
        allRevealed={allRevealed}
        onRevealAll={revealAll}
        onHideAll={hideAll}
        onDownload={handleDownload}
        downloadingMode={downloadingMode}
      />

      <div className="exam-paper-surface bg-background/40 px-3 py-4 sm:px-8 sm:py-7">
        {showBanner && paper.header ? (
          <ExamBannerHeader header={paper.header} />
        ) : null}

        <div className="mt-4 flex flex-col gap-6">
          {paper.exercises.map((exercise) => (
            <ExerciseBlock
              key={exercise.id}
              exercise={exercise}
              revealed={revealed}
              onToggle={toggleRevealed}
            />
          ))}
        </div>

        {paper.footer ? (
          <ExamFooter
            footer={paper.footer}
            totalMarks={sumExerciseMarks(paper.exercises)}
          />
        ) : null}
      </div>
    </aside>
  );
}

// ---- Toolbar -----------------------------------------------------------

interface ExamToolbarProps {
  hasAnyCorrection: boolean;
  allRevealed: boolean;
  onRevealAll: () => void;
  onHideAll: () => void;
  onDownload: (mode: "enonce" | "corrige" | "both") => void;
  downloadingMode: null | "enonce" | "corrige" | "both";
}

/**
 * Top toolbar — show/hide-all (when the paper has any corrigé)
 * and the three download modes. Each download mode produces an
 * A4 PDF via `downloadExamPdf`. Hidden in the off-screen export
 * tree via the `.exam-pdf-export` rules in `globals.css`, so the
 * exported paper carries no UI chrome.
 */
function ExamToolbar({
  hasAnyCorrection,
  allRevealed,
  onRevealAll,
  onHideAll,
  onDownload,
  downloadingMode,
}: ExamToolbarProps) {
  // On mobile, the toolbar buttons would either crowd the toolbar
  // off the right edge or wrap into a tall stack — we shorten the
  // visible labels to fit two rows max while keeping a screen-reader
  // friendly full label in `aria-label` / a hidden `<span>`.
  const isBusy = downloadingMode !== null;
  return (
    <div className="exam-paper-toolbar flex flex-wrap items-center justify-between gap-1.5 border-b border-border bg-muted/30 px-2 py-2 text-xs sm:gap-2 sm:px-3">
      <div className="flex items-center gap-1.5">
        {hasAnyCorrection ? (
          allRevealed ? (
            <button
              type="button"
              onClick={onHideAll}
              aria-label="Tout masquer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-medium text-foreground/80 hover:bg-muted"
            >
              <EyeOff className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Tout masquer</span>
              <span className="sm:hidden">Masquer</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onRevealAll}
              aria-label="Tout afficher"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-medium text-foreground/80 hover:bg-muted"
            >
              <Eye className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">Tout afficher</span>
              <span className="sm:hidden">Afficher</span>
            </button>
          )
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <DownloadButton
          mode="enonce"
          label="Sujet (PDF)"
          shortLabel="Sujet"
          ariaLabel="Télécharger le sujet en PDF"
          icon={<Download className="size-3.5" aria-hidden />}
          onDownload={onDownload}
          busy={downloadingMode === "enonce"}
          disabled={isBusy && downloadingMode !== "enonce"}
        />
        {hasAnyCorrection ? (
          <>
            <DownloadButton
              mode="both"
              label="Sujet + corrigé (PDF)"
              shortLabel="Sujet+Corr."
              ariaLabel="Télécharger le sujet et le corrigé en PDF"
              icon={<FileText className="size-3.5" aria-hidden />}
              onDownload={onDownload}
              busy={downloadingMode === "both"}
              disabled={isBusy && downloadingMode !== "both"}
            />
            <DownloadButton
              mode="corrige"
              label="Corrigé (PDF)"
              shortLabel="Corrigé"
              ariaLabel="Télécharger le corrigé seul en PDF"
              icon={<ScrollText className="size-3.5" aria-hidden />}
              onDownload={onDownload}
              busy={downloadingMode === "corrige"}
              disabled={isBusy && downloadingMode !== "corrige"}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

interface DownloadButtonProps {
  mode: "enonce" | "corrige" | "both";
  label: string;
  shortLabel: string;
  ariaLabel: string;
  icon: React.ReactNode;
  busy: boolean;
  disabled: boolean;
  onDownload: (mode: "enonce" | "corrige" | "both") => void;
}

/**
 * A single download button. Renders a spinner in place of the
 * leading icon while a PDF is being rasterised for this specific
 * mode; the other two buttons grey out via `disabled` so the
 * student doesn't queue up multiple concurrent renders on a slow
 * device.
 */
function DownloadButton({
  mode,
  label,
  shortLabel,
  ariaLabel,
  icon,
  busy,
  disabled,
  onDownload,
}: DownloadButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onDownload(mode)}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      disabled={busy || disabled}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 font-medium text-foreground/80 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        icon
      )}
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{shortLabel}</span>
    </button>
  );
}

// ---- Banner ------------------------------------------------------------

interface ExamBannerHeaderProps {
  header: ExamHeader;
}

/**
 * Faux Tunisian BAC banner — three centred lines for the
 * authority (République Tunisienne / Ministère de l'Éducation /
 * Direction des Examens et Concours), then the exam title
 * (EXAMEN DU BACCALAURÉAT) + session line, then a thin rule, then
 * a metadata table (Section · Épreuve · Coefficient · Durée).
 * Skips the metadata row entirely if no metadata is set.
 */
function ExamBannerHeader({ header }: ExamBannerHeaderProps) {
  const sessionLabel = formatSession(header.session, header.year);

  // Build the metadata row — each item appears only if the
  // corresponding field is set, so we never render empty cells
  // like "Coefficient : —".
  const meta: { label: string; value: string }[] = [];
  if (header.section) meta.push({ label: "Section", value: header.section });
  if (header.matiere) meta.push({ label: "Épreuve", value: header.matiere });
  if (header.coefficient !== undefined && header.coefficient !== null) {
    meta.push({ label: "Coefficient", value: String(header.coefficient) });
  }
  if (header.duration_hours !== undefined && header.duration_hours !== null) {
    meta.push({
      label: "Durée",
      value: formatDuration(header.duration_hours),
    });
  }

  return (
    <header className="exam-banner mb-5 border-b border-border pb-4 text-center">
      <div className="font-serif text-[13px] uppercase tracking-wide text-foreground/80">
        République Tunisienne
      </div>
      <div className="font-serif text-[13px] uppercase tracking-wide text-foreground/80">
        Ministère de l&apos;Éducation
      </div>
      <div className="font-serif text-[12px] uppercase tracking-wider text-foreground/70">
        Direction des Examens et Concours
      </div>

      <div className="mt-3 font-serif text-base font-semibold uppercase tracking-wider text-foreground sm:text-lg">
        Examen du Baccalauréat
      </div>
      {sessionLabel ? (
        <div className="font-serif text-[13px] uppercase tracking-wide text-foreground/80">
          {sessionLabel}
        </div>
      ) : null}

      {meta.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] sm:text-[13px]">
          {meta.map((entry) => (
            <span key={entry.label} className="text-foreground/85">
              <span className="font-medium">{entry.label} :</span>{" "}
              <span>{entry.value}</span>
            </span>
          ))}
          {header.calculator_allowed !== undefined ? (
            <span className="text-foreground/70">
              {header.calculator_allowed
                ? "Calculatrice non programmable autorisée"
                : "Calculatrice non autorisée"}
            </span>
          ) : null}
        </div>
      ) : null}

      {header.notes_md ? (
        <div className="mt-3 text-left text-[12px] text-muted-foreground sm:text-[13px]">
          <MessageResponse>{wrapBareLatex(header.notes_md)}</MessageResponse>
        </div>
      ) : null}
    </header>
  );
}

// ---- Exercise + parts --------------------------------------------------

interface ExerciseBlockProps {
  exercise: ExamExercise;
  revealed: Set<string>;
  onToggle: (id: string) => void;
}

/**
 * One exercise — heading row (label + optional title + marks on
 * the right), optional intro paragraph, then the recursive parts
 * tree starting at depth 0.
 */
function ExerciseBlock({ exercise, revealed, onToggle }: ExerciseBlockProps) {
  return (
    <section
      data-exercise-id={exercise.id}
      className="exam-exercise"
      // `page-break-inside: avoid` is set in print CSS so an
      // exercise tries to stay on one page when feasible.
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border pb-1.5">
        <h3 className="font-serif text-[15px] font-semibold tracking-wide text-foreground sm:text-[16px]">
          {exercise.label}
          {exercise.title ? (
            <span className="ml-2 font-normal italic text-foreground/75">
              — {exercise.title}
            </span>
          ) : null}
        </h3>
        {exercise.marks !== undefined && exercise.marks !== null ? (
          <span className="ml-auto whitespace-nowrap text-[12px] font-medium text-muted-foreground">
            ({formatMarks(exercise.marks)} {pluralisePoint(exercise.marks)})
          </span>
        ) : null}
      </div>

      {exercise.intro_md ? (
        <div className="exam-prompt mt-2 text-[13px] leading-relaxed text-foreground/90 sm:text-[14px]">
          <MessageResponse>{wrapBareLatex(exercise.intro_md)}</MessageResponse>
        </div>
      ) : null}

      <ol className="mt-2 flex flex-col gap-2">
        {exercise.parts.map((part) => (
          <PartNode
            key={part.id}
            node={part}
            depth={0}
            revealed={revealed}
            onToggle={onToggle}
          />
        ))}
      </ol>
    </section>
  );
}

interface PartNodeProps {
  node: ExamPart;
  depth: number;
  revealed: Set<string>;
  onToggle: (id: string) => void;
}

/**
 * Recursive part renderer. Each level renders:
 *   - a label cell (BAC-style numbering like "1.", "1.a)") on
 *     the left;
 *   - the prompt (LaTeX-in-markdown) in the middle;
 *   - optional marks on the right;
 *   - optional per-leaf correction disclosure underneath;
 *   - optional nested `<ol>` of child parts beneath.
 *
 * Depth-based indentation is applied via a left padding so the
 * nesting reads visually like a real BAC paper.
 */
function PartNode({ node, depth, revealed, onToggle }: PartNodeProps) {
  const hasChildren = Array.isArray(node.parts) && node.parts.length > 0;
  // Leaf parts are the only place we render a correction
  // disclosure — inner-node `correction` blocks are ignored
  // (the agent prompt warns against them) so we don't accidentally
  // show two layers of "Voir la correction" for the same content.
  const hasCorrection = !hasChildren && Boolean(node.correction);
  const isRevealed = revealed.has(node.id);

  // Indent each nesting level by ~10 px on mobile / ~18 px on
  // desktop. Capped at depth 4 — beyond that the indentation
  // would push prompts off the right margin. We use a CSS custom
  // property + a stylesheet rule (in `globals.css`) so the
  // breakpoint applies via `@media` rather than inline style.
  const depthLevel = Math.min(depth, 4);

  return (
    <li
      className="exam-part flex flex-col gap-1"
      style={{ "--exam-depth": depthLevel } as React.CSSProperties}
      data-part-id={node.id}
      data-part-depth={depth}
    >
      <div className="exam-prompt flex flex-wrap items-start gap-x-2 gap-y-0.5 sm:flex-nowrap">
        <span className="mt-0.5 inline-block min-w-[1.8rem] shrink-0 font-serif text-[13px] font-semibold text-foreground/80 sm:min-w-[2.2rem] sm:text-[14px]">
          {node.label}
        </span>
        <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-foreground/90 sm:text-[14px]">
          <MessageResponse>{wrapBareLatex(node.prompt_md)}</MessageResponse>
        </div>
        {!hasChildren &&
        node.marks !== undefined &&
        node.marks !== null ? (
          <span className="ml-auto mt-0.5 whitespace-nowrap text-[12px] font-medium text-muted-foreground sm:ml-0">
            ({formatMarks(node.marks)} pt
            {node.marks > 1 ? "s" : ""})
          </span>
        ) : null}
      </div>

      {hasCorrection ? (
        <CorrectionDisclosure
          id={node.id}
          correction={node.correction!}
          isRevealed={isRevealed}
          onToggle={() => onToggle(node.id)}
        />
      ) : null}

      {hasChildren ? (
        <ol className="mt-1 flex flex-col gap-2">
          {node.parts!.map((child) => (
            <PartNode
              key={child.id}
              node={child}
              depth={depth + 1}
              revealed={revealed}
              onToggle={onToggle}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

// ---- Correction disclosure --------------------------------------------

interface CorrectionDisclosureProps {
  id: string;
  correction: ExamCorrection;
  isRevealed: boolean;
  onToggle: () => void;
}

/**
 * Per-leaf-part correction disclosure. Collapsed by default — the
 * student is forced to attempt the question before peeking.
 * Once revealed, shows:
 *   - the worked solution (LaTeX-in-markdown);
 *   - the optional Tunisian-style *Barème* breakdown;
 *   - an optional pedagogical *Remarque* callout;
 *   - an optional *Erreur classique* warning callout.
 *
 * The block stays in the DOM even when collapsed (via the
 * `hidden` attribute), so the print stylesheet can override
 * `[hidden]` to force it visible in "sujet + corrigé" / "corrigé
 * seul" print modes without touching React state.
 */
function CorrectionDisclosure({
  id,
  correction,
  isRevealed,
  onToggle,
}: CorrectionDisclosureProps) {
  const labelId = `exam-correction-trigger-${id}`;
  return (
    <div className="exam-correction-wrapper ml-7 mt-1 sm:ml-[2.7rem]">
      <button
        type="button"
        id={labelId}
        onClick={onToggle}
        aria-expanded={isRevealed}
        className={cn(
          "exam-correction-trigger inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/30 px-2 py-1 text-[12px] font-medium text-foreground/70",
          "hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        )}
      >
        <Sparkles className="size-3.5" aria-hidden />
        {isRevealed ? "Masquer la correction" : "Voir la correction"}
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            isRevealed && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <div
        className="exam-correction mt-1.5 rounded-md border border-border bg-card/70 px-2.5 py-2 text-[12.5px] leading-relaxed text-foreground/85 sm:px-3 sm:py-2.5 sm:text-[13.5px]"
        hidden={!isRevealed}
        aria-labelledby={labelId}
      >
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Correction
        </div>
        <div className="mt-1">
          <MessageResponse>
            {wrapBareLatex(correction.solution_md)}
          </MessageResponse>
        </div>

        {correction.marks_breakdown &&
        correction.marks_breakdown.length > 0 ? (
          <div className="exam-bareme mt-2 rounded-md bg-muted/40 px-2 py-1.5 sm:px-2.5 sm:py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Barème
            </div>
            <ul className="mt-1 flex flex-col gap-1">
              {correction.marks_breakdown.map((row, idx) => (
                <li
                  key={idx}
                  className="exam-bareme-row text-[12px] sm:text-[12.5px]"
                >
                  <span className="exam-bareme-marks mr-2 font-medium text-foreground/85">
                    {formatMarks(row.marks)} pt
                    {row.marks > 1 ? "s" : ""}
                    {" :"}
                  </span>
                  <span className="exam-bareme-reason text-foreground/80">
                    <MessageResponse>
                      {wrapBareLatex(row.reason)}
                    </MessageResponse>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {correction.remark_md ? (
          <div className="mt-2 rounded-md border border-chart-3/25 bg-chart-3/5 px-2 py-1.5 sm:px-2.5 sm:py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-chart-3/90">
              Remarque
            </div>
            <div className="mt-0.5">
              <MessageResponse>
                {wrapBareLatex(correction.remark_md)}
              </MessageResponse>
            </div>
          </div>
        ) : null}

        {correction.common_mistake_md ? (
          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 sm:px-2.5 sm:py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Erreur classique
            </div>
            <div className="mt-0.5">
              <MessageResponse>
                {wrapBareLatex(correction.common_mistake_md)}
              </MessageResponse>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---- Footer ------------------------------------------------------------

interface ExamFooterProps {
  footer: ExamFooterPayload;
  totalMarks: number | null;
}

function ExamFooter({ footer, totalMarks }: ExamFooterProps) {
  const declaredTotal =
    footer.total_marks !== undefined && footer.total_marks !== null
      ? footer.total_marks
      : null;

  // Visual mismatch flag — if the declared total doesn't match
  // the sum of exercise marks we render a tiny amber strip so
  // the student knows the paper isn't perfectly internally
  // consistent. We don't refuse to render — the agent can drift
  // by half a mark and the paper is still useful.
  const mismatch =
    declaredTotal !== null &&
    totalMarks !== null &&
    Math.abs(declaredTotal - totalMarks) > 0.001;

  return (
    <footer className="mt-6 border-t border-border pt-3 text-[12px] text-muted-foreground sm:text-[12.5px]">
      <div className="flex flex-wrap items-baseline gap-3">
        {declaredTotal !== null ? (
          <span>
            <span className="font-medium text-foreground/80">
              Total :
            </span>{" "}
            {formatMarks(declaredTotal)} points
          </span>
        ) : null}
        {mismatch ? (
          <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
            Somme des exercices :{" "}
            {totalMarks !== null ? formatMarks(totalMarks) : "—"} pts
          </span>
        ) : null}
      </div>
      {footer.closing_note_md ? (
        <div className="mt-1 italic">
          <MessageResponse>
            {wrapBareLatex(footer.closing_note_md)}
          </MessageResponse>
        </div>
      ) : null}
    </footer>
  );
}

// ---- Payload extraction -----------------------------------------------

interface ExamHeader {
  matiere?: string;
  year?: number;
  session?: "principale" | "controle" | "rattrapage";
  section?: string;
  duration_hours?: number;
  coefficient?: number;
  calculator_allowed?: boolean;
  notes_md?: string;
}

interface ExamPart {
  id: string;
  label: string;
  marks?: number;
  prompt_md: string;
  expected_answer_format?: string;
  parts?: ExamPart[];
  correction?: ExamCorrection;
}

interface ExamCorrection {
  solution_md: string;
  marks_breakdown?: { marks: number; reason: string }[];
  remark_md?: string;
  common_mistake_md?: string;
}

interface ExamExercise {
  id: string;
  label: string;
  title?: string;
  marks?: number;
  intro_md?: string;
  parts: ExamPart[];
}

interface ExamFooterPayload {
  total_marks?: number;
  closing_note_md?: string;
}

interface ExamPaperPayload {
  kind: "full_paper" | "single_exercise" | "short_set";
  language?: string;
  header?: ExamHeader;
  exercises: ExamExercise[];
  footer?: ExamFooterPayload;
}

/**
 * Pull the exam payload off a `tool-emit_exam` part.
 *
 * `emit_*` tools carry their authored payload as the *input* —
 * the server-side function is a no-op echo. We require `kind`,
 * at least one exercise, and at least one part on the first
 * exercise before rendering; anything weaker would be a
 * half-built paper and is better suppressed.
 */
function extractExam(part: LemmaEmitExamToolPart): ExamPaperPayload | null {
  if (!("input" in part) || part.input === undefined || part.input === null) {
    return null;
  }
  const input = part.input as {
    kind?: unknown;
    language?: unknown;
    header?: unknown;
    exercises?: unknown;
    footer?: unknown;
  };

  const kind = readKind(input.kind);
  if (!kind) return null;

  const exercises = readExercises(input.exercises);
  if (!exercises || exercises.length === 0) return null;
  if (exercises[0].parts.length === 0) return null;

  const language = nonEmptyString(input.language) ?? undefined;
  const header = readHeader(input.header);
  const footer = readFooter(input.footer);

  return { kind, language, header, exercises, footer };
}

function readKind(
  v: unknown,
): "full_paper" | "single_exercise" | "short_set" | null {
  if (v === "full_paper" || v === "single_exercise" || v === "short_set") {
    return v;
  }
  return null;
}

function readHeader(v: unknown): ExamHeader | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const session = readSession(o.session);
  const header: ExamHeader = {
    matiere: nonEmptyString(o.matiere) ?? undefined,
    year: typeof o.year === "number" ? o.year : undefined,
    session,
    section: nonEmptyString(o.section) ?? undefined,
    duration_hours:
      typeof o.duration_hours === "number" ? o.duration_hours : undefined,
    coefficient:
      typeof o.coefficient === "number" ? o.coefficient : undefined,
    calculator_allowed:
      typeof o.calculator_allowed === "boolean"
        ? o.calculator_allowed
        : undefined,
    notes_md: nonEmptyString(o.notes_md) ?? undefined,
  };
  // Suppress an entirely-empty header so we don't render an
  // empty banner block when the agent forgot to populate it.
  if (
    !header.matiere &&
    !header.year &&
    !header.session &&
    !header.section &&
    header.duration_hours === undefined &&
    header.coefficient === undefined &&
    header.calculator_allowed === undefined &&
    !header.notes_md
  ) {
    return undefined;
  }
  return header;
}

function readSession(
  v: unknown,
): "principale" | "controle" | "rattrapage" | undefined {
  if (v === "principale" || v === "controle" || v === "rattrapage") {
    return v;
  }
  return undefined;
}

function readFooter(v: unknown): ExamFooterPayload | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const total_marks =
    typeof o.total_marks === "number" ? o.total_marks : undefined;
  const closing_note_md = nonEmptyString(o.closing_note_md) ?? undefined;
  if (total_marks === undefined && !closing_note_md) return undefined;
  return { total_marks, closing_note_md };
}

function readExercises(v: unknown): ExamExercise[] | null {
  if (!Array.isArray(v)) return null;
  const out: ExamExercise[] = [];
  v.forEach((rawExercise, idx) => {
    if (!rawExercise || typeof rawExercise !== "object") return;
    const eo = rawExercise as Record<string, unknown>;
    const id = nonEmptyString(eo.id) ?? `exercise-${idx}`;
    const label = nonEmptyString(eo.label) ?? `Exercice ${idx + 1}`;
    const title = nonEmptyString(eo.title) ?? undefined;
    const marks = typeof eo.marks === "number" ? eo.marks : undefined;
    const intro_md = nonEmptyString(eo.intro_md) ?? undefined;
    const parts = readParts(eo.parts, `${id}-p`);
    if (!parts) return;
    out.push({ id, label, title, marks, intro_md, parts });
  });
  return out;
}

function readParts(v: unknown, idPrefix: string): ExamPart[] | null {
  if (!Array.isArray(v)) return null;
  const out: ExamPart[] = [];
  v.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const po = raw as Record<string, unknown>;
    const prompt_md = nonEmptyString(po.prompt_md);
    if (!prompt_md) return;
    const id = nonEmptyString(po.id) ?? `${idPrefix}-${idx}`;
    const label = nonEmptyString(po.label) ?? `${idx + 1}.`;
    const marks = typeof po.marks === "number" ? po.marks : undefined;
    const expected_answer_format =
      nonEmptyString(po.expected_answer_format) ?? undefined;
    const children = readParts(po.parts, `${id}-p`);
    const correction = readCorrection(po.correction);
    out.push({
      id,
      label,
      marks,
      prompt_md,
      expected_answer_format,
      parts: children ?? undefined,
      correction,
    });
  });
  return out;
}

function readCorrection(v: unknown): ExamCorrection | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const solution_md = nonEmptyString(o.solution_md);
  if (!solution_md) return undefined;
  const remark_md = nonEmptyString(o.remark_md) ?? undefined;
  const common_mistake_md = nonEmptyString(o.common_mistake_md) ?? undefined;
  const marks_breakdown = Array.isArray(o.marks_breakdown)
    ? (o.marks_breakdown
        .map((row): { marks: number; reason: string } | null => {
          if (!row || typeof row !== "object") return null;
          const r = row as Record<string, unknown>;
          const marks = typeof r.marks === "number" ? r.marks : null;
          const reason = nonEmptyString(r.reason);
          if (marks === null || !reason) return null;
          return { marks, reason };
        })
        .filter((row): row is { marks: number; reason: string } =>
          Boolean(row),
        ) as { marks: number; reason: string }[])
    : undefined;
  return {
    solution_md,
    marks_breakdown:
      marks_breakdown && marks_breakdown.length > 0
        ? marks_breakdown
        : undefined,
    remark_md,
    common_mistake_md,
  };
}

// ---- Helpers -----------------------------------------------------------

function collectLeafIdsWithCorrection(
  parts: ExamPart[],
  out: string[],
): void {
  for (const part of parts) {
    if (part.parts && part.parts.length > 0) {
      collectLeafIdsWithCorrection(part.parts, out);
    } else if (part.correction) {
      out.push(part.id);
    }
  }
}

function sumExerciseMarks(exercises: ExamExercise[]): number | null {
  let total = 0;
  let any = false;
  for (const ex of exercises) {
    if (ex.marks !== undefined && ex.marks !== null) {
      total += ex.marks;
      any = true;
    }
  }
  return any ? total : null;
}

function nonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatMarks(n: number): string {
  // Strip trailing zeros so "1.0" becomes "1" but "1.25" stays.
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(2)));
}

function pluralisePoint(n: number): string {
  return n > 1 ? "points" : "point";
}

function formatDuration(hours: number): string {
  if (Number.isInteger(hours)) return `${hours}h`;
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  if (minutes === 0) return `${whole}h`;
  return `${whole}h${String(minutes).padStart(2, "0")}`;
}

function formatSession(
  session: "principale" | "controle" | "rattrapage" | undefined,
  year: number | undefined,
): string | null {
  if (!session && !year) return null;
  const sessionLabel = session
    ? session === "principale"
      ? "Session principale"
      : session === "controle"
        ? "Session de contrôle"
        : "Session de rattrapage"
    : null;
  if (sessionLabel && year) return `${sessionLabel} ${year}`;
  if (sessionLabel) return sessionLabel;
  if (year) return `Session ${year}`;
  return null;
}
