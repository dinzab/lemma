"use client";

import * as React from "react";
import {
  ArrowUp,
  Loader2,
  Square,
  Paperclip,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
  /**
   * Visual size. `"compact"` (default) is used inside an active thread:
   * one-line minimum that grows up to ~200px. `"hero"` is used on the
   * empty state where we want a slightly more prominent input.
   */
  size?: "compact" | "hero";
  autoFocus?: boolean;
}

const COMPACT_MAX_HEIGHT_PX = 200;
const HERO_MAX_HEIGHT_PX = 280;

/**
 * Shared composer used on the empty `/new` page and inside an active chat.
 * Auto-resizes from one line up to a fixed max-height. The surface has a
 * soft elevated card, a focus ring, and a 36px send target that scales
 * to a comfortable tap area on mobile.
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
  size = "compact",
  autoFocus = false,
}: PromptComposerProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const trimmed = value.trim();
  const sendDisabled = !trimmed || isSubmitting || disabled;
  const showStop = isStreaming && typeof onStop === "function";
  const isSelectable = typeof onSelectMode === "function";
  const hasModes = !!modes && modes.length > 0;

  const maxHeightPx = size === "hero" ? HERO_MAX_HEIGHT_PX : COMPACT_MAX_HEIGHT_PX;

  const resize = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxHeightPx);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeightPx ? "auto" : "hidden";
  }, [maxHeightPx]);

  React.useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

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
          "group relative flex flex-col rounded-3xl border border-border bg-card/85 backdrop-blur",
          "shadow-[0_1px_2px_rgba(74,64,55,0.06),0_8px_24px_-12px_rgba(74,64,55,0.10)]",
          "dark:bg-card/70 dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),0_10px_28px_-12px_rgba(0,0,0,0.5)]",
          "transition-[border-color,box-shadow] duration-150",
          "focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15",
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          autoFocus={autoFocus}
          disabled={disabled || isSubmitting}
          className={cn(
            "block w-full resize-none border-0 bg-transparent text-foreground",
            "placeholder:text-muted-foreground/70 focus:outline-none",
            size === "hero"
              ? "px-5 pt-5 pb-2 text-base leading-7 sm:px-6 sm:pt-6 sm:text-[17px] sm:leading-8"
              : "px-4 pt-3 pb-1 text-[15px] leading-6 sm:px-5",
            textareaClassName,
          )}
          style={{ minHeight: size === "hero" ? "96px" : "28px" }}
        />

        <div
          className={cn(
            "flex items-end justify-between gap-2 pb-2 pt-1",
            size === "hero" ? "px-2.5 pb-3 sm:px-3.5" : "px-2 sm:px-2.5",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {/* Attach is hidden on xs so the mode chips have room to breathe
                on a 360px viewport. The button is still disabled-only today
                ("coming soon"); when it lights up we can revisit. */}
            <button
              type="button"
              aria-label="Attach (coming soon)"
              disabled
              className={cn(
                "hidden shrink-0 items-center justify-center rounded-full text-muted-foreground/70 sm:flex",
                size === "hero" ? "h-10 w-10" : "h-9 w-9",
                "transition-colors hover:text-foreground disabled:opacity-50",
              )}
            >
              <Paperclip
                className={cn(size === "hero" ? "h-[19px] w-[19px]" : "h-[17px] w-[17px]")}
              />
            </button>

            {hasModes && (
              <div className="flex items-center gap-0.5">
                {modes!.map((mode) => {
                  const Icon = mode.icon;
                  const isActive = selectedModeId === mode.id;
                  const baseClass = cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full font-medium transition-colors sm:gap-1.5",
                    size === "hero"
                      ? "px-2.5 py-1.5 text-[13px] sm:px-3 sm:text-sm"
                      : "px-2 py-1 text-[12px] sm:px-2.5 sm:text-[12.5px]",
                  );
                  const iconClass = size === "hero" ? "h-4 w-4" : "h-3.5 w-3.5";

                  if (!isSelectable) {
                    return (
                      <span
                        key={mode.id}
                        className={cn(baseClass, "text-muted-foreground")}
                      >
                        <Icon className={iconClass} />
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
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <Icon className={iconClass} />
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center">
            {showStop ? (
              <Button
                type="button"
                onClick={onStop}
                size="icon"
                aria-label="Stop generating"
                className={cn(
                  "rounded-full bg-foreground text-background hover:bg-foreground/90",
                  size === "hero" ? "h-11 w-11" : "h-9 w-9",
                )}
              >
                <Square
                  className={cn(size === "hero" ? "h-3.5 w-3.5" : "h-3 w-3", "fill-current")}
                />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={onSubmit}
                disabled={sendDisabled}
                size="icon"
                aria-label="Send message"
                className={cn(
                  "rounded-full transition-all",
                  size === "hero" ? "h-11 w-11" : "h-9 w-9",
                  trimmed && !isSubmitting
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "cursor-not-allowed bg-muted text-muted-foreground/60 hover:bg-muted",
                )}
              >
                {isSubmitting ? (
                  <Loader2 className={cn(size === "hero" ? "h-5 w-5" : "h-4 w-4", "animate-spin")} />
                ) : (
                  <ArrowUp
                    className={cn(size === "hero" ? "h-5 w-5" : "h-4 w-4")}
                    strokeWidth={2.5}
                  />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
