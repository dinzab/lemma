"use client";

import { useState } from "react";

import { ChatRowActions } from "@/components/chat/ChatRowActions";
import { cn } from "@/lib/utils";

interface ChatHeaderProps {
  /**
   * The current thread title. Falls back to a placeholder when null
   * (e.g. while the page is still validating thread access).
   */
  title: string | null;
  /** Called when the user successfully renames this thread. */
  onRename: (nextTitle: string) => Promise<void>;
  /** Called when the user successfully deletes this thread. */
  onDelete: () => Promise<void>;
  className?: string;
}

/**
 * Slim sticky header for the active chat page.
 *
 * The chat surface used to show no header at all — the only place the thread
 * title appeared was in the (collapsed-on-mobile) sidebar. That left the user
 * with no quick context for "which conversation am I in?" and no way to
 * rename / delete the open chat without first opening the sidebar.
 *
 * The header keeps a tight 44px vertical footprint, centres the title with
 * single-line truncation, and exposes the same Rename / Delete actions as
 * the sidebar's kebab menu so the action surface is consistent.
 */
export function ChatHeader({
  title,
  onRename,
  onDelete,
  className,
}: ChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const displayTitle = title?.trim() || "New conversation";

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-background/80 px-3 py-2 backdrop-blur-sm sm:px-4",
        className,
      )}
    >
      {/* Spacer matches the right-side action width so the title stays
          visually centred on desktop. On mobile the dashboard's hamburger
          button already lives in the layout — we don't duplicate it here. */}
      <div className="hidden w-9 sm:block" aria-hidden />

      <h1
        className="flex-1 truncate text-center text-sm font-medium text-foreground"
        title={displayTitle}
      >
        {displayTitle}
      </h1>

      <div className="flex w-9 items-center justify-end">
        {title && (
          <ChatRowActions
            threadTitle={displayTitle}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onRename={onRename}
            onDelete={onDelete}
            triggerClassName="opacity-100"
          />
        )}
      </div>
    </header>
  );
}
