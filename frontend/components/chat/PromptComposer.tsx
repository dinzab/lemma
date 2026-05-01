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
  className?: string;
  textareaClassName?: string;
  rows?: number;
  autoFocus?: boolean;
}

/**
 * Shared composer used on the empty `/new` page and inside an active chat.
 * The card is transparent — it inherits the page background and shows just
 * a soft border outline. Inside: textarea, optional mode chips, send/stop.
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
  className,
  textareaClassName,
  rows = 3,
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
      <div
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-transparent",
          "transition-colors duration-200",
          "focus-within:border-primary/40",
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
            "!min-h-[104px] w-full resize-none border-0 bg-transparent px-5 pb-2 pt-5 text-[15px] leading-relaxed shadow-none",
            "placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:outline-none",
            textareaClassName,
          )}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 px-3 pb-3 pt-1 sm:px-4">
          <div className="flex flex-wrap items-center gap-1">
            {modes?.map((mode) => {
              const Icon = mode.icon;
              const isActive = selectedModeId === mode.id;
              const baseClass =
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium transition-colors";

              if (!isSelectable) {
                return (
                  <span
                    key={mode.id}
                    className={cn(baseClass, "text-muted-foreground")}
                  >
                    <Icon className="h-[15px] w-[15px]" />
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
                    "cursor-pointer",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-[15px] w-[15px]" />
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
                className="h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/30 hover:bg-primary/90"
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
                  "h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/30 transition-all hover:bg-primary/90",
                  sendDisabled && "cursor-not-allowed opacity-70",
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
