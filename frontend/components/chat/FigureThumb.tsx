"use client";

import { useState } from "react";
import { ImageOff, Maximize2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";

interface FigureThumbProps {
  url: string | null | undefined;
  alt: string;
  /**
   * Visual size of the thumbnail. The lightbox renders at full
   * viewport regardless. Defaults to "md".
   *  - sm  : compact inline preview (used inside `PastPaperChip`)
   *  - md  : standard preview (used inside `QuestionAssetsBlock`)
   *  - lg  : large preview (used as the dominant card on the panel)
   */
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<FigureThumbProps["size"]>, string> = {
  sm: "max-h-24 w-auto max-w-[180px]",
  md: "max-h-48 w-auto max-w-xs",
  lg: "max-h-80 w-auto max-w-md",
};

/**
 * Lazy-loaded figure preview with click-to-zoom lightbox.
 *
 * Used in two places:
 *  1. `PastPaperChip` — passive thumbnail of the énoncé figure when a
 *     search hit carries `has_figure_enonce: true`. This is the (B)
 *     half of the hybrid figure surfacing pattern: students see the
 *     visual hook while browsing, no extra click required.
 *  2. `QuestionAssetsBlock` — main figure renderer inside each tab
 *     of the explicit `<show_question_assets>` panel. This is the
 *     (C) half: the agent decides when the panel surfaces.
 *
 * Click anywhere on the thumb (or hit Enter / Space) to open the
 * Radix-portaled lightbox at full viewport. Escape / click-outside /
 * the close button all dismiss it. We deliberately do NOT preload the
 * full-resolution PNG — the `<img>` tag uses `loading="lazy"` and the
 * lightbox simply re-targets the same URL (browsers cache the bytes
 * after the first decode).
 *
 * Renders nothing if `url` is falsy.
 */
export function FigureThumb({ url, alt, size = "md", className }: FigureThumbProps) {
  const [open, setOpen] = useState(false);
  const [errored, setErrored] = useState(false);

  if (!url) return null;

  if (errored) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-dashed border-muted-foreground/30",
          "bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground",
          className,
        )}
        role="img"
        aria-label="Figure not available"
      >
        <ImageOff className="size-3" aria-hidden />
        figure indisponible
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Agrandir : ${alt}`}
        className={cn(
          "group relative inline-flex overflow-hidden rounded-md border border-border/60 bg-muted/30",
          "shadow-sm transition hover:border-secondary/40 hover:shadow",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/40",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
          className={cn(
            "block h-auto object-contain",
            SIZE_CLASSES[size],
          )}
        />
        <span
          aria-hidden
          className={cn(
            "absolute right-1 top-1 flex size-6 items-center justify-center",
            "rounded-md bg-background/85 text-foreground/70 opacity-0 shadow-sm",
            "transition group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        >
          <Maximize2 className="size-3.5" />
        </span>
      </button>

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
            <DialogTitle className="sr-only">{alt}</DialogTitle>
            <div className="relative flex w-full items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={alt}
                className={cn(
                  "block max-h-[90vh] max-w-full rounded-lg bg-background object-contain shadow-2xl",
                )}
              />
              <DialogClose
                aria-label="Fermer"
                className={cn(
                  "absolute right-2 top-2 inline-flex size-9 items-center justify-center",
                  "rounded-full bg-background/90 text-foreground shadow-md ring-1 ring-border",
                  "transition hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/50",
                )}
              >
                <X className="size-4" />
              </DialogClose>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  );
}
