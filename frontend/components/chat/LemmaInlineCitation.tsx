"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ImageOff, Maximize2, ScrollText } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFigureRegistry } from "@/context/figure-registry-context";
import type { FigureKey } from "@/context/figure-registry-context";
import {
  resolveLemmaUri,
  type ResolvedDossierFigureResponse,
  type ResolvedExamResponse,
  type ResolvedExerciseResponse,
  type ResolvedFigureResponse,
  type ResolvedPairResponse,
  type ResolvedReference,
} from "@/lib/api/references";

/**
 * Inline `lemma:` citation chips rendered by the Streamdown `<a>`
 * override in `<MessageResponse>`. Two flavours:
 *
 *  1. `<LemmaInlineCitation>` for `lemma:pair:…`, `lemma:exercise:…`,
 *     and `lemma:exam:…` — a small pill that scrolls the page to the
 *     matching `<QuestionCard>` / `<PastPaperChip>` /
 *     `<QuestionAssetsBlock>` (matched against `data-pair-id`).
 *     `pair` URIs match the full pair_id; `exercise` / `exam` URIs
 *     match by prefix because `pair_id` is always shaped
 *     `<exam_id>:ex_<n>:q_<n>` — so any block on the page that
 *     belongs to the cited exercise / exam will satisfy the click.
 *     The chip flashes a brief highlight ring on the matched card so
 *     the student visually catches the "I'm pointing here" cue.
 *
 *  2. `<LemmaInlineCitationFigure>` for `lemma:fig:…` — a tiny
 *     thumbnail + label pulled from the conversation's
 *     `<FigureRegistry>`, click pops the standard FigureThumb
 *     lightbox so the student can verify the figure mentioned in
 *     prose.
 *
 * Both are MEMO-friendly leaf components: they only depend on the
 * `refUri` + the registry, so re-renders during streaming are
 * cheap.
 */

interface LemmaInlineCitationProps {
  refUri: string;
  className?: string;
  children?: ReactNode;
}

type LemmaUriKind = "pair" | "exercise" | "exam";

interface ParsedLemmaUri {
  kind: LemmaUriKind;
  /** Bare identifier following the `lemma:<kind>:` prefix. */
  id: string;
}

/**
 * Parse a scrollable `lemma:` URI into its kind + identifier. Returns
 * `null` for malformed URIs and for `lemma:fig:…` (which is handled
 * by `<LemmaInlineCitationFigure>` and never routed through this
 * parser).
 */
function parseLemmaScrollUri(refUri: string): ParsedLemmaUri | null {
  const prefixes: Array<{ prefix: string; kind: LemmaUriKind }> = [
    { prefix: "lemma:pair:", kind: "pair" },
    { prefix: "lemma:exercise:", kind: "exercise" },
    { prefix: "lemma:exam:", kind: "exam" },
  ];
  for (const { prefix, kind } of prefixes) {
    if (refUri.startsWith(prefix)) {
      const rest = refUri.slice(prefix.length);
      return rest.length > 0 ? { kind, id: rest } : null;
    }
  }
  return null;
}

/**
 * Find the on-page surface that matches a parsed lemma URI. We match
 * everything against `data-pair-id` because `pair_id` already encodes
 * exam + exercise + question:
 *
 *   pair_id        = "<exam_id>:ex_<n>:q_<n>"
 *   lemma:pair:    → exact match on data-pair-id
 *   lemma:exercise:→ prefix match "<exercise_id>:" against data-pair-id
 *   lemma:exam:    → prefix match "<exam_id>:"     against data-pair-id
 *
 * No need to mint extra `data-exercise-id` / `data-exam-id`
 * attributes on every block component as long as something on the
 * page is keyed by a matching pair_id.
 */
function findScrollTarget(parsed: ParsedLemmaUri): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (parsed.kind === "pair") {
    return document.querySelector<HTMLElement>(
      `[data-pair-id="${cssEscape(parsed.id)}"]`,
    );
  }
  // exercise / exam: prefix-match against data-pair-id. `^=` is the
  // CSS prefix-match selector; we append `:` so `ex_3` doesn't also
  // match a hypothetical `ex_30`.
  const prefix = `${parsed.id}:`;
  return document.querySelector<HTMLElement>(
    `[data-pair-id^="${cssEscape(prefix)}"]`,
  );
}

/**
 * `lemma:pair:…` / `lemma:exercise:…` / `lemma:exam:…` chip.
 * Click intercepts the custom-protocol href, finds the matching
 * surface on the page (`<QuestionCard>` / `<PastPaperChip>` /
 * `<QuestionAssetsBlock>`), scrolls it into view, and flashes a
 * brief highlight ring. If no match is on the page (e.g. the agent
 * cited a question whose card isn't currently rendered) the click
 * falls back to opening a Reference dialog populated by the
 * `/references/lemma` resolver — exam title, exercise figures, full
 * énoncé scan when the corpus has it — so the chip is never inert.
 */
export function LemmaInlineCitation({
  refUri,
  className,
  children,
}: LemmaInlineCitationProps) {
  const parsed = parseLemmaScrollUri(refUri);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Resolved payload for the fallback Dialog. We lazily fetch on the
  // first click that misses the on-page scroll target, then reuse the
  // memoised result for subsequent clicks.
  const [resolved, setResolved] = useState<ResolvedReference | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Always intercept — the href is a custom protocol the browser
      // would otherwise refuse to navigate to.
      e.preventDefault();
      if (!parsed) return;
      const target = findScrollTarget(parsed);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        // Briefly flash a highlight ring so the student sees what we
        // pointed at. We add + remove a class instead of inlining
        // styles so the colour stays themable.
        target.classList.add(LEMMA_FLASH_CLASS);
        window.setTimeout(() => {
          target.classList.remove(LEMMA_FLASH_CLASS);
        }, LEMMA_FLASH_MS);
        return;
      }
      // No scroll target on the page — pop the resolver-backed
      // Dialog so the chip stays useful even when the cited
      // exercise / pair / exam wasn't surfaced on a card. We
      // open the dialog optimistically and resolve in parallel
      // so the loading state lives inside it.
      setDialogOpen(true);
      if (!resolved && !resolving) {
        setResolving(true);
        setResolveError(null);
        resolveLemmaUri(refUri)
          .then((r) => {
            setResolved(r);
            if (!r) {
              setResolveError(
                "Désolé, cette référence est introuvable dans le corpus.",
              );
            }
          })
          .catch((err) => {
            setResolveError(
              err instanceof Error ? err.message : "Erreur réseau.",
            );
          })
          .finally(() => setResolving(false));
      }
    },
    [parsed, refUri, resolved, resolving],
  );

  return (
    <>
      <a
        href={refUri}
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 align-baseline",
          "rounded-md border border-secondary/40 bg-secondary/10 px-1.5 py-0.5",
          "text-[12px] font-medium text-foreground no-underline",
          "transition hover:border-secondary/60 hover:bg-secondary/15",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/40",
          className,
        )}
      >
        <ScrollText
          className="size-3 shrink-0 text-secondary"
          aria-hidden
        />
        <span className="truncate">{children}</span>
      </a>
      <LemmaReferenceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        fallbackLabel={typeof children === "string" ? children : refUri}
        resolved={resolved}
        resolving={resolving}
        error={resolveError}
      />
    </>
  );
}

const LEMMA_FLASH_CLASS = "ring-2 ring-secondary/60 ring-offset-2";
const LEMMA_FLASH_MS = 1400;

/**
 * Best-effort CSS attribute escape — pair_id only contains
 * `[a-z0-9_:.\-]` in the v6 grammar, so the only character we'd
 * realistically have to escape is `:`. We use `CSS.escape` when
 * available for forward-compat with stranger pair_ids.
 */
function cssEscape(value: string): string {
  if (
    typeof window !== "undefined" &&
    typeof window.CSS?.escape === "function"
  ) {
    return window.CSS.escape(value);
  }
  return value.replace(/(["\\])/g, "\\$1");
}

interface LemmaInlineCitationFigureProps {
  refUri: string;
  className?: string;
  children?: ReactNode;
}

/**
 * `lemma:fig:…` chip — a tiny thumbnail + label that pops the
 * FigureThumb lightbox on click.
 *
 * Resolution order:
 *   1. The conversation-scoped `<FigureRegistry>` populated by
 *      `<LemmaConversation>`'s tool-output collector. Cheapest:
 *      pure in-memory lookup against figures that came back with
 *      the agent's tool calls.
 *   2. The `/api/references/lemma` resolver — fired lazily on
 *      mount when the registry has no entry. Fixes the broken
 *      "figure indisponible" fallback the user saw when the
 *      agent cited `lemma:fig:…` without firing a tool that
 *      registered the figure (and the chip just rendered as a
 *      dashed broken-image icon).
 *
 * The fallback fetcher is memoised process-wide by
 * `resolveLemmaUri`, so even if the same chip is mounted in
 * multiple messages we only hit the network once per URI.
 */
export function LemmaInlineCitationFigure({
  refUri,
  className,
  children,
}: LemmaInlineCitationFigureProps) {
  const key = parseFigureRefUri(refUri);
  const registry = useFigureRegistry();
  const registered = key ? registry.getFigure(key) : null;
  const [open, setOpen] = useState(false);
  const [errored, setErrored] = useState(false);
  // Backend-resolver fallback. Only fired when the in-conversation
  // registry has nothing for this URI; cleared if the registry
  // catches up (e.g. the matching tool call lands later).
  const [resolved, setResolved] =
    useState<ResolvedFigureResponse | null>(null);

  useEffect(() => {
    if (registered?.url) return;
    if (resolved) return;
    let cancelled = false;
    resolveLemmaUri(refUri)
      .then((r) => {
        if (cancelled) return;
        if (r && r.kind === "figure") setResolved(r);
      })
      .catch(() => {
        // Resolver failures fall through to the dashed
        // unavailable chip — silent so a transient network
        // hiccup doesn't pollute the message log.
      });
    return () => {
      cancelled = true;
    };
  }, [refUri, registered?.url, resolved]);

  // Normalise the registered + resolved sources into one shape so the
  // render path doesn't have to care which came back.
  const fig: { url: string | null; caption: string | null; alt: string; shortLabel: string } | null =
    registered?.url
      ? {
          url: registered.url,
          caption: registered.caption,
          alt: registered.alt,
          shortLabel: registered.shortLabel,
        }
      : resolved?.figure?.url
        ? {
            url: resolved.figure.url,
            caption: resolved.figure.caption,
            alt:
              resolved.figure.citation?.label ??
              resolved.figure.label ??
              "figure",
            shortLabel:
              resolved.figure.citation?.short_label ??
              resolved.figure.label ??
              "figure",
          }
        : null;

  const labelText =
    typeof children === "string" && children.trim().length > 0
      ? children
      : fig?.shortLabel ?? "figure";

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      if (!fig?.url || errored) return;
      setOpen(true);
    },
    [fig?.url, errored],
  );

  if (!fig?.url) {
    return (
      <a
        href={refUri}
        onClick={(e) => e.preventDefault()}
        className={cn(
          "inline-flex items-center gap-1 align-baseline",
          "rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-1.5 py-0.5",
          "text-[12px] font-medium text-muted-foreground no-underline",
          className,
        )}
      >
        <ImageOff className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{labelText}</span>
      </a>
    );
  }

  const caption = fig.caption?.trim() || null;
  const accessibleAlt = caption ? `${fig.alt} — ${caption}` : fig.alt;

  return (
    <>
      <a
        href={refUri}
        onClick={onClick}
        title={caption ?? undefined}
        aria-label={`Agrandir : ${accessibleAlt}`}
        className={cn(
          "inline-flex items-center gap-1 align-baseline",
          "rounded-md border border-secondary/40 bg-secondary/10 px-1 py-0.5",
          "text-[12px] font-medium text-foreground no-underline",
          "transition hover:border-secondary/60 hover:bg-secondary/15",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/40",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={fig.url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
          className="h-5 w-5 shrink-0 rounded-sm border border-border/60 object-cover"
        />
        <span className="truncate">{labelText}</span>
        <Maximize2
          className="size-3 shrink-0 text-secondary"
          aria-hidden
        />
      </a>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogOverlay className="bg-black/80" />
          <DialogContent
            showCloseButton={false}
            className={cn(
              "max-w-[95vw] sm:max-w-[95vw]",
              "border-0 bg-transparent p-0 shadow-none",
            )}
          >
            <DialogTitle className="sr-only">{accessibleAlt}</DialogTitle>
            <div
              className={cn(
                "relative max-h-[90vh] w-full overflow-auto rounded-lg bg-background shadow-2xl",
                "touch-manipulation",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fig.url}
                alt={accessibleAlt}
                className="block h-auto w-full max-w-none object-contain"
              />
              {caption && (
                <p
                  className={cn(
                    "px-4 py-3 text-[13px] leading-relaxed",
                    "border-t border-border/60 bg-muted/40 text-muted-foreground",
                  )}
                >
                  {caption}
                </p>
              )}
              <DialogClose
                aria-label="Fermer"
                className={cn(
                  "absolute right-3 top-3 inline-flex size-8 items-center justify-center",
                  "rounded-full bg-background/90 text-foreground shadow",
                  "transition hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/40",
                )}
              >
                ×
              </DialogClose>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  );
}

/**
 * Parse either canonical or legacy `lemma:fig:…` URI into a
 * FigureRegistry lookup key. Mirrors the helper in
 * `LemmaConversation` but lives here so the chip can resolve its
 * key independently of the collector.
 *
 *   canonical: lemma:fig:<exam>:<exercise>:<question>:<side>:<index>
 *              → { pair_id: "<exam>:<exercise>:<question>", … }
 *   legacy:    lemma:fig:<exam>:<exercise>:<side>:<index>
 *              → { pair_id: "<exam>:<exercise>", … }
 */
function parseFigureRefUri(refUri: string): FigureKey | null {
  if (!refUri.startsWith("lemma:fig:")) return null;
  const rest = refUri.slice("lemma:fig:".length);
  const parts = rest.split(":");
  if (parts.length < 4) return null;
  const index = Number.parseInt(parts[parts.length - 1], 10);
  const sideRaw = parts[parts.length - 2];
  if (sideRaw !== "enonce" && sideRaw !== "corrige") return null;
  if (!Number.isFinite(index) || index < 0) return null;
  const handle = parts.slice(0, parts.length - 2).join(":");
  if (!handle) return null;
  return { pair_id: handle, side: sideRaw, index };
}

/**
 * Resolver-backed fallback Dialog for the `lemma:pair:` /
 * `lemma:exercise:` / `lemma:exam:` chip — popped when the chip's
 * click finds no on-page surface to scroll to. Renders a compact
 * "open the source" panel: chip label header, full-exam scan
 * thumbnail, and a list of figures with click-through to a
 * lightbox.
 *
 * Kept inside `LemmaInlineCitation.tsx` so all `lemma:`-aware UI
 * sits under one roof — the resolver, the parsing helpers, and the
 * fallback rendering all change together.
 */
interface LemmaReferenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fallbackLabel: string;
  resolved: ResolvedReference | null;
  resolving: boolean;
  error: string | null;
}

function LemmaReferenceDialog({
  open,
  onOpenChange,
  fallbackLabel,
  resolved,
  resolving,
  error,
}: LemmaReferenceDialogProps) {
  const title =
    (resolved && "label" in resolved && resolved.label) || fallbackLabel;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-black/70" />
        <DialogContent
          className={cn(
            "max-w-[min(720px,95vw)] sm:max-w-[min(720px,95vw)]",
            "max-h-[85vh] overflow-y-auto p-0",
          )}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <div className="space-y-4 p-5">
            <header className="space-y-1">
              <h3 className="text-sm font-semibold leading-tight text-foreground">
                {title}
              </h3>
              {resolved && "exam" in resolved && (
                <p className="text-[12px] text-muted-foreground">
                  {[
                    resolved.exam.matiere,
                    resolved.exam.year,
                    resolved.exam.session,
                    resolved.exam.track,
                  ]
                    .filter(Boolean)
                    .join(" — ")}
                </p>
              )}
            </header>

            {resolving && !resolved && (
              <p className="text-[13px] text-muted-foreground">
                Chargement de la référence…
              </p>
            )}

            {error && (
              <p className="text-[13px] text-destructive">{error}</p>
            )}

            {resolved && resolved.kind === "figure" && (
              <ResolvedFigureBody resolved={resolved} />
            )}
            {resolved && resolved.kind === "exercise" && (
              <ResolvedExerciseBody resolved={resolved} />
            )}
            {resolved && resolved.kind === "pair" && (
              <ResolvedPairBody resolved={resolved} />
            )}
            {resolved && resolved.kind === "exam" && (
              <ResolvedExamBody resolved={resolved} />
            )}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function ResolvedFigureBody({
  resolved,
}: {
  resolved: ResolvedFigureResponse;
}) {
  if (!resolved.figure.url) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Aucune image disponible pour cette figure.
      </p>
    );
  }
  return (
    <figure className="space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved.figure.url}
        alt={resolved.figure.label}
        className="block w-full rounded-md border border-border/60 bg-background object-contain"
      />
      {resolved.figure.caption && (
        <figcaption className="text-[12px] text-muted-foreground">
          {resolved.figure.caption}
        </figcaption>
      )}
    </figure>
  );
}

function ResolvedExerciseBody({
  resolved,
}: {
  resolved: ResolvedExerciseResponse;
}) {
  return (
    <div className="space-y-3">
      {resolved.exercise.exercise_enonce_image_url && (
        <FullExerciseScan
          url={resolved.exercise.exercise_enonce_image_url}
          alt={`Énoncé — ${resolved.label}`}
        />
      )}
      <FigureGrid
        side="énoncé"
        figures={resolved.figures.enonce}
      />
      <FigureGrid
        side="correction"
        figures={resolved.figures.corrige}
      />
      {resolved.figures.enonce.length === 0 &&
        resolved.figures.corrige.length === 0 &&
        !resolved.exercise.exercise_enonce_image_url && (
          <p className="text-[13px] text-muted-foreground">
            Cet exercice n&apos;a pas d&apos;illustrations dans le corpus.
          </p>
        )}
    </div>
  );
}

function ResolvedPairBody({
  resolved,
}: {
  resolved: ResolvedPairResponse;
}) {
  return (
    <div className="space-y-3">
      {resolved.question_text && (
        <section>
          <h4 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Énoncé
          </h4>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
            {resolved.question_text}
          </p>
        </section>
      )}
      <FigureGrid
        side="énoncé"
        figures={resolved.figures.enonce}
      />
      <FigureGrid
        side="correction"
        figures={resolved.figures.corrige}
      />
    </div>
  );
}

function ResolvedExamBody({
  resolved,
}: {
  resolved: ResolvedExamResponse;
}) {
  return (
    <div className="space-y-3">
      {resolved.exam_full_enonce_url && (
        <FullExerciseScan
          url={resolved.exam_full_enonce_url}
          alt={`Énoncé complet — ${resolved.label}`}
        />
      )}
      <ul className="space-y-1 text-[13px] text-foreground">
        {resolved.exercises.map((ex) => (
          <li
            key={ex.exercise_handle}
            className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2"
          >
            <span>
              Exercice {ex.exercise_number ?? "?"} — {ex.n_questions}{" "}
              question{ex.n_questions === 1 ? "" : "s"}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {ex.n_enonce_figures + ex.n_corrige_figures} figure
              {ex.n_enonce_figures + ex.n_corrige_figures === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FullExerciseScan({ url, alt }: { url: string; alt: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-md border border-border/60"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        loading="lazy"
        className="block w-full bg-background object-contain"
      />
    </a>
  );
}

interface LemmaInlineCitationDossierFigureProps {
  refUri: string;
  className?: string;
  children?: ReactNode;
}

interface ParsedDossierFigureUri {
  exam_handle: string;
  figure_id: string;
}

/**
 * Parse `lemma:dossier_fig:<exam_handle>:<figure_id>` into the
 * (exam, figure) pair. Both segments must be non-empty and free of
 * extra colons — the URI grammar carries no escape rules.
 */
function parseDossierFigureRefUri(
  refUri: string,
): ParsedDossierFigureUri | null {
  if (!refUri.startsWith("lemma:dossier_fig:")) return null;
  const rest = refUri.slice("lemma:dossier_fig:".length);
  const parts = rest.split(":");
  if (parts.length !== 2) return null;
  const [exam_handle, figure_id] = parts;
  if (!exam_handle || !figure_id) return null;
  return { exam_handle, figure_id };
}

/**
 * `lemma:dossier_fig:…` chip. Renders as a compact pill (similar
 * spirit to `<LemmaInlineCitationFigure>` but visually distinct —
 * a "DT" badge marks it as a *dossier technique* / dossier-scoped
 * figure rather than a per-pair énoncé figure).
 *
 * Click behaviour:
 *
 *  1. Try to scroll to the matching figure inside an on-page
 *     `<QuestionAssetsBlock>` "Dossier technique" tab (the
 *     `<DossierTab>` annotates each figure entry with
 *     `data-dossier-figure="<figure_id>"`).
 *  2. If no on-page surface matches, fall back to the
 *     `/api/references/lemma` resolver and pop a lightbox showing
 *     the full dossier page PNG with the figure label highlighted.
 */
export function LemmaInlineCitationDossierFigure({
  refUri,
  className,
  children,
}: LemmaInlineCitationDossierFigureProps) {
  const parsed = parseDossierFigureRefUri(refUri);
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] =
    useState<ResolvedDossierFigureResponse | null>(null);

  useEffect(() => {
    if (!parsed) return;
    if (resolved) return;
    let cancelled = false;
    resolveLemmaUri(refUri)
      .then((r) => {
        if (cancelled) return;
        if (r && r.kind === "dossier_figure") setResolved(r);
      })
      .catch(() => {
        // Silent — the chip falls back to a label-only pill if
        // the resolver fails. We don't want a transient network
        // hiccup to surface as a broken-figure UI.
      });
    return () => {
      cancelled = true;
    };
  }, [refUri, resolved, parsed]);

  const labelText =
    typeof children === "string" && children.trim().length > 0
      ? children
      : resolved?.figure.label ?? "figure du dossier";

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      if (!parsed) return;
      // Try to find the figure entry on the page (rendered by
      // `<DossierTab>`). The lookup is exact on `data-dossier-figure`.
      if (typeof document !== "undefined") {
        const target = document.querySelector<HTMLElement>(
          `[data-dossier-figure="${cssEscape(parsed.figure_id)}"]`,
        );
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add(...LEMMA_FLASH_CLASS.split(" "));
          window.setTimeout(() => {
            target.classList.remove(...LEMMA_FLASH_CLASS.split(" "));
          }, LEMMA_FLASH_MS);
          return;
        }
      }
      // Nothing on the page; pop the lightbox.
      setOpen(true);
    },
    [parsed],
  );

  if (!parsed) {
    return (
      <a
        href={refUri}
        onClick={(e) => e.preventDefault()}
        className={cn(
          "inline-flex items-center gap-1 align-baseline",
          "rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-1.5 py-0.5",
          "text-[12px] font-medium text-muted-foreground no-underline",
          className,
        )}
      >
        <span className="truncate">{labelText}</span>
      </a>
    );
  }

  const pagePng = resolved?.figure.page_png ?? null;
  return (
    <>
      <a
        href={refUri}
        onClick={onClick}
        aria-label={`Voir ${labelText} du dossier`}
        className={cn(
          "inline-flex items-center gap-1 align-baseline",
          "rounded-md border border-chart-2/40 bg-chart-2/10 px-1.5 py-0.5",
          "text-[12px] font-medium text-foreground no-underline",
          "transition hover:border-chart-2/60 hover:bg-chart-2/15",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-2/40",
          className,
        )}
      >
        <span
          aria-hidden
          className="rounded-sm bg-chart-2/20 px-1 text-[10px] font-semibold uppercase tracking-wider text-chart-2"
        >
          DT
        </span>
        <span className="truncate">{labelText}</span>
      </a>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogOverlay className="bg-black/80" />
          <DialogContent
            showCloseButton={false}
            className={cn(
              "max-w-[95vw] sm:max-w-[95vw]",
              "border-0 bg-transparent p-0 shadow-none",
            )}
          >
            <DialogTitle className="sr-only">
              {resolved?.reference_doc_kind_label ?? "Dossier"} — {labelText}
            </DialogTitle>
            <div
              className={cn(
                "relative max-h-[90vh] w-full overflow-auto rounded-lg bg-background shadow-2xl",
              )}
            >
              {pagePng ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pagePng}
                  alt={`${resolved?.reference_doc_kind_label ?? "Dossier"} — ${labelText}`}
                  className="block h-auto w-full max-w-none object-contain"
                />
              ) : (
                <div className="flex h-40 w-full items-center justify-center text-muted-foreground">
                  <ImageOff className="size-6" aria-hidden />
                </div>
              )}
              {resolved?.figure.description && (
                <p
                  className={cn(
                    "px-4 py-3 text-[13px] leading-relaxed",
                    "border-t border-border/60 bg-muted/40 text-muted-foreground",
                  )}
                >
                  {resolved.figure.description}
                </p>
              )}
              <DialogClose
                aria-label="Fermer"
                className={cn(
                  "absolute right-3 top-3 inline-flex size-8 items-center justify-center",
                  "rounded-full bg-background/90 text-foreground shadow",
                  "transition hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-2/40",
                )}
              >
                ×
              </DialogClose>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  );
}

function FigureGrid({
  side,
  figures,
}: {
  side: string;
  figures: ResolvedExerciseResponse["figures"]["enonce"];
}) {
  if (figures.length === 0) return null;
  return (
    <section>
      <h4 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        Figures de l&apos;{side}
      </h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {figures.map((fig) => (
          <a
            key={`${fig.side}:${fig.index}`}
            href={fig.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!fig.url) e.preventDefault();
            }}
            className={cn(
              "flex flex-col gap-1 rounded-md border border-border/60 bg-background p-2",
              "transition hover:border-secondary/50 hover:bg-muted/30",
            )}
          >
            {fig.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fig.url}
                alt={fig.label}
                loading="lazy"
                className="h-32 w-full rounded-sm object-contain"
              />
            ) : (
              <div className="flex h-32 w-full items-center justify-center rounded-sm bg-muted text-muted-foreground">
                <ImageOff className="size-5" aria-hidden />
              </div>
            )}
            <span className="text-[12px] font-medium text-foreground">
              {fig.label}
            </span>
            {fig.caption && (
              <span className="text-[11px] text-muted-foreground">
                {fig.caption}
              </span>
            )}
          </a>
        ))}
      </div>
    </section>
  );
}
