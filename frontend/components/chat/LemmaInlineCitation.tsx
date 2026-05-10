"use client";

import { useCallback, useState, type ReactNode } from "react";
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

/**
 * Inline `lemma:` citation chips rendered by the Streamdown `<a>`
 * override in `<MessageResponse>`. Two flavours:
 *
 *  1. `<LemmaInlineCitation>` for `lemma:pair:…`, `lemma:exercise:…`,
 *     and `lemma:exam:…` — a small pill that scrolls the page to the
 *     matching `<QuestionCard>` / `<PastPaperChip>` (data-pair-id),
 *     and falls back to a non-active label otherwise. The pair URI
 *     also flashes a brief highlight ring on the matched card so the
 *     student visually catches the "I'm pointing here" cue.
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

/** Parsed `lemma:pair:<exam>:<exercise>:<question>` -> `<exam>:<exercise>:<question>`. */
function pairIdFromRefUri(refUri: string): string | null {
  if (refUri.startsWith("lemma:pair:")) {
    const rest = refUri.slice("lemma:pair:".length);
    return rest.length > 0 ? rest : null;
  }
  return null;
}

/**
 * `lemma:pair:…` / `lemma:exercise:…` / `lemma:exam:…` chip.
 * Click action depends on the URI flavour:
 *  - `pair`: scroll to the matching card on the page (matched by
 *    `data-pair-id`). If no match found, the chip stays static.
 *  - `exercise` / `exam`: chip is non-active (no scroll target on
 *    page), but rendered as a labelled pill so the prose still has
 *    the bridge to the citation.
 */
export function LemmaInlineCitation({
  refUri,
  className,
  children,
}: LemmaInlineCitationProps) {
  const pairId = pairIdFromRefUri(refUri);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Always intercept — the href is a custom protocol the browser
      // would otherwise refuse to navigate to.
      e.preventDefault();
      if (!pairId || typeof document === "undefined") return;
      const target = document.querySelector<HTMLElement>(
        `[data-pair-id="${cssEscape(pairId)}"]`,
      );
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      // Briefly flash a highlight ring so the student sees what we
      // pointed at. We add + remove a class instead of inlining
      // styles so the colour stays themable.
      target.classList.add(LEMMA_FLASH_CLASS);
      window.setTimeout(() => {
        target.classList.remove(LEMMA_FLASH_CLASS);
      }, LEMMA_FLASH_MS);
    },
    [pairId],
  );

  return (
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
 * FigureThumb lightbox on click. Pulls the figure's URL + caption
 * from the `<FigureRegistry>` populated by `<LemmaConversation>`'s
 * tool-output collector. Falls back to a static label-only chip
 * when the registry doesn't (yet) have an entry — typical during
 * the agent's first turn after firing the tool while the message
 * stream is still arriving.
 */
export function LemmaInlineCitationFigure({
  refUri,
  className,
  children,
}: LemmaInlineCitationFigureProps) {
  const key = parseFigureRefUri(refUri);
  const registry = useFigureRegistry();
  const fig = key ? registry.getFigure(key) : null;
  const [open, setOpen] = useState(false);
  const [errored, setErrored] = useState(false);

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
 * Parse `lemma:fig:<exam>:<exercise>:<side>:<index>` into a
 * FigureRegistry lookup key. Mirrors the helper in
 * `LemmaConversation` but lives here so the chip can resolve its
 * key independently of the collector.
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
