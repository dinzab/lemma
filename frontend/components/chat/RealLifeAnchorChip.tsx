"use client";

import { useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";
import type { DynamicToolUIPart, ToolUIPart } from "ai";

import { cn } from "@/lib/utils";

export type LemmaAnalogyToolPart = DynamicToolUIPart | ToolUIPart;

interface RealLifeAnchorChipProps {
  part: LemmaAnalogyToolPart;
}

/**
 * Inline render block A12 — *Dans la vraie vie*.
 *
 * Renders a curated Tunisian real-life anchor as a soft pinned card in
 * the message stream, replacing the default debug-style `<LemmaToolCall>`
 * collapsible for `tool-recall_analogy` parts.
 *
 * Two intentional behaviours:
 *
 * 1. We render NOTHING when the tool returned `covered: false` — the
 *    library doesn't have an anchor for this concept and the agent is
 *    instructed not to fabricate one. A blank space is the correct
 *    "honest" UI in that case.
 * 2. We render NOTHING while the tool is still streaming (`input-streaming`
 *    or `input-available`) — there's no anchor to show yet and a
 *    skeleton would be more noise than signal. The chip pops in only
 *    once the output is back, which mirrors how the rest of the chat
 *    surface handles incremental rendering.
 */
export function RealLifeAnchorChip({ part }: RealLifeAnchorChipProps) {
  const [expanded, setExpanded] = useState(false);
  const anchor = extractAnchor(part);

  if (!anchor) return null;

  const hasFull =
    typeof anchor.full === "string" &&
    anchor.full.trim().length > 0 &&
    anchor.full.trim() !== anchor.short.trim();

  return (
    <aside
      aria-label="Analogie de la vraie vie"
      className={cn(
        "my-3 w-full rounded-xl border border-primary/15 bg-primary/5",
        "px-4 py-3 text-sm text-foreground shadow-sm",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/15"
        >
          <MapPin className="size-3.5 text-primary" />
        </span>

        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">
            Dans la vraie vie
          </div>

          <div className="mt-0.5 text-[13px] font-medium text-foreground">
            {anchor.label}
          </div>

          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {anchor.short}
          </p>

          {hasFull && (
            <>
              {expanded && (
                <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">
                  {anchor.full}
                </p>
              )}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline focus:outline-none focus-visible:underline"
              >
                {expanded ? "Réduire" : "Tell me more"}
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

interface AnchorPayload {
  id?: string;
  concept_label?: string;
  matiere?: string[];
  label: string;
  short: string;
  full?: string;
  language?: string;
  tags?: string[];
}

interface RecallAnalogyOutput {
  covered: boolean;
  anchor?: AnchorPayload;
  concept_query?: string;
}

/**
 * Pull the anchor object out of a `tool-recall_analogy` part. The
 * backend returns a JSON-stringified payload, but `ai`'s `tool-*` parts
 * sometimes surface that as either a parsed object or the raw string —
 * handle both shapes defensively so we never crash a chat render
 * because a tool changed its serialization.
 */
function extractAnchor(part: LemmaAnalogyToolPart): AnchorPayload | null {
  if (!("output" in part) || part.output === undefined || part.output === null) {
    return null;
  }

  const parsed = parseOutput(part.output);
  if (!parsed || typeof parsed !== "object") return null;
  if ((parsed as RecallAnalogyOutput).covered !== true) return null;

  const anchor = (parsed as RecallAnalogyOutput).anchor;
  if (!anchor || typeof anchor.label !== "string" || typeof anchor.short !== "string") {
    return null;
  }

  return anchor;
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
