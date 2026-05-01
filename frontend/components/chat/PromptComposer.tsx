"use client";

import * as React from "react";
import {
  ArrowUp,
  ChevronDown,
  Compass,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Square,
  Telescope,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  placeholder?: string;
  isStreaming?: boolean;
  isSubmitting?: boolean;
  disabled?: boolean;
  className?: string;
  textareaClassName?: string;
  rows?: number;
  autoFocus?: boolean;
}

interface ChipDefinition {
  id: string;
  label: string;
  icon: LucideIcon;
}

const chips: ChipDefinition[] = [
  { id: "reasoning", label: "Reasoning", icon: Compass },
  { id: "deep-research", label: "Deep research", icon: Telescope },
  { id: "image", label: "Image generation", icon: ImageIcon },
];

/**
 * Shared composer used on the empty `/new` page and inside an active chat.
 * Two-row layout: a textarea on top and an action bar below containing
 * an attachment button, capability chips, a model selector, and a circular
 * send/stop button.
 *
 * The chips and model selector are visual placeholders for now.
 */
export function PromptComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  placeholder = "What can I do for you?",
  isStreaming = false,
  isSubmitting = false,
  disabled = false,
  className,
  textareaClassName,
  rows = 3,
  autoFocus = false,
}: PromptComposerProps) {
  const trimmed = value.trim();
  const sendDisabled = !trimmed || isSubmitting || disabled;
  const showStop = isStreaming && typeof onStop === "function";

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (showStop) {
        onStop?.();
        return;
      }
      if (!sendDisabled) {
        onSubmit();
      }
    }
  };

  return (
    <div className={cn("relative w-full", className)}>
      <div
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-card",
          "shadow-[0_2px_0_0_rgba(0,0,0,0.02),0_8px_24px_-18px_rgba(0,0,0,0.25)]",
          "transition-colors duration-200",
          "focus-within:border-border focus-within:shadow-[0_2px_0_0_rgba(0,0,0,0.03),0_12px_32px_-18px_rgba(0,0,0,0.3)]",
        )}
      >
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          autoFocus={autoFocus}
          disabled={disabled || isSubmitting}
          className={cn(
            "!min-h-[96px] w-full resize-none border-0 bg-transparent px-6 pb-2 pt-6 text-[15px] leading-relaxed shadow-none",
            "placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:outline-none",
            textareaClassName,
          )}
        />

        <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-2 sm:px-5">
          <button
            type="button"
            aria-label="Attach file"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/60 text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {chips.map((chip) => {
              const Icon = chip.icon;
              return (
                <button
                  key={chip.id}
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3.5 py-1.5 text-[13px] font-medium text-foreground/80 transition-colors",
                    "hover:border-border hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {chip.label}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-2 py-1.5 text-[13px] font-medium text-foreground/80 transition-colors",
                "hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"
                aria-hidden
              >
                <span className="h-2 w-2 rounded-full bg-white" />
              </span>
              <span>Lemma 1.0</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </button>

            {showStop ? (
              <Button
                type="button"
                onClick={onStop}
                size="icon"
                aria-label="Stop generating"
                className="h-9 w-9 rounded-full bg-foreground text-background shadow-sm hover:bg-foreground/90"
              >
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={onSubmit}
                disabled={sendDisabled}
                size="icon"
                aria-label="Send message"
                className={cn(
                  "h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/30 transition-all",
                  sendDisabled
                    ? "cursor-not-allowed opacity-90"
                    : "hover:bg-primary/90",
                )}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
