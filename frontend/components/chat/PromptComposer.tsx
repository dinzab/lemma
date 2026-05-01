"use client";

import * as React from "react";
import { ArrowUp, Loader2, Square, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface PromptComposerMode {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  placeholder?: string;
  isStreaming?: boolean;
  isSubmitting?: boolean;
  disabled?: boolean;
  modes?: PromptComposerMode[];
  selectedModeId?: string;
  onSelectMode?: (id: string) => void;
  /** Show the soft animated aurora glow behind the card. */
  showAura?: boolean;
  className?: string;
  textareaClassName?: string;
  rows?: number;
  autoFocus?: boolean;
}

/**
 * Shared composer used on the empty `/new` page and inside an active chat.
 * Includes an animated aurora glow, an action chip row, and a prominent
 * send / stop button.
 */
export function PromptComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  placeholder = "Ask BacPrep AI anything…",
  isStreaming = false,
  isSubmitting = false,
  disabled = false,
  modes,
  selectedModeId,
  onSelectMode,
  showAura = true,
  className,
  textareaClassName,
  rows = 1,
  autoFocus = false,
}: PromptComposerProps) {
  const trimmed = value.trim();
  const sendDisabled = !trimmed || isSubmitting || disabled;
  const showStop = isStreaming && typeof onStop === "function";
  const isSelectable = typeof onSelectMode === "function";

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
      {showAura && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-4 -z-10 rounded-[28px] opacity-70 blur-2xl"
        >
          <div className="absolute inset-x-10 top-0 h-24 rounded-full bg-primary/30 blur-3xl" />
          <div className="absolute -bottom-2 left-1/4 h-24 w-1/2 rounded-full bg-secondary/25 blur-3xl" />
          <div className="absolute -bottom-3 right-6 h-20 w-1/3 rounded-full bg-chart-3/20 blur-3xl" />
        </div>
      )}

      <div
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/80 backdrop-blur",
          "shadow-[0_18px_55px_-25px_rgba(0,0,0,0.45)] transition-all duration-300",
          "focus-within:border-primary/50 focus-within:shadow-[0_25px_65px_-25px_rgba(0,0,0,0.55)]",
          "focus-within:ring-1 focus-within:ring-primary/30",
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-60 transition-opacity group-focus-within:opacity-100"
        />

        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          autoFocus={autoFocus}
          disabled={disabled || isSubmitting}
          className={cn(
            "!min-h-14 w-full resize-none border-0 bg-transparent px-5 pb-2 pt-4 text-[15px] leading-relaxed shadow-none",
            "placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:outline-none",
            textareaClassName,
          )}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-3 py-2.5 sm:px-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {modes?.map((mode) => {
              const Icon = mode.icon;
              const isActive = selectedModeId === mode.id;
              const baseClass =
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all";

              if (!isSelectable) {
                return (
                  <span
                    key={mode.id}
                    className={cn(
                      baseClass,
                      "border-border/70 bg-background/60 text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {mode.label}
                  </span>
                );
              }

              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => onSelectMode?.(mode.id)}
                  aria-pressed={isActive}
                  className={cn(
                    baseClass,
                    "cursor-pointer hover:-translate-y-px active:translate-y-0",
                    isActive
                      ? "border-primary/40 bg-primary/15 text-primary shadow-sm shadow-primary/10"
                      : "border-border/70 bg-background/70 text-muted-foreground hover:border-primary/30 hover:bg-primary/10 hover:text-primary",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {mode.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            {showStop ? (
              <Button
                type="button"
                onClick={onStop}
                size="icon"
                aria-label="Stop generating"
                className="h-10 w-10 rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 hover:bg-primary/90"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={onSubmit}
                disabled={sendDisabled}
                size="icon"
                aria-label="Send message"
                className={cn(
                  "h-10 w-10 rounded-full transition-all",
                  trimmed && !isSubmitting
                    ? "bg-gradient-to-br from-primary to-chart-3 text-primary-foreground shadow-md shadow-primary/30 hover:scale-[1.04] hover:shadow-primary/40"
                    : "cursor-not-allowed bg-muted text-muted-foreground/50",
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
