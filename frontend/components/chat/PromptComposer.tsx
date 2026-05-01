"use client";

import * as React from "react";
import {
  ArrowUp,
  ChevronDown,
  Loader2,
  Plus,
  Square,
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

/**
 * Single integrated composer card. Inside: textarea, a + (attach) icon,
 * a model selector, and a circular send/stop button. No internal chips
 * or per-button backgrounds — everything reads as one card.
 */
export function PromptComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  placeholder = "How can I help you today?",
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
          "group relative flex flex-col overflow-hidden rounded-3xl border border-border/60 bg-card",
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
            "!min-h-[88px] w-full resize-none border-0 bg-transparent px-5 pb-2 pt-5 text-[15px] leading-relaxed shadow-none",
            "placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:outline-none",
            textareaClassName,
          )}
        />

        <div className="flex items-center gap-1 px-3 pb-3 pt-1 sm:px-4">
          <button
            type="button"
            aria-label="Attach"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            <Plus className="h-[18px] w-[18px]" />
          </button>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors",
                "hover:bg-muted/70 hover:text-foreground",
              )}
            >
              <span>Lemma 1.0</span>
              <span className="text-muted-foreground/70">Adaptive</span>
              <ChevronDown className="h-3.5 w-3.5" />
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
