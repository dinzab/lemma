"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ChatRowActionsProps {
  threadTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (nextTitle: string) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  /**
   * On touch devices we don't get hover, so the trigger should always be
   * visible. On desktop we hide it until the row is hovered or the menu
   * is open. This is controlled by the `[data-touch]` attribute set by
   * the parent — we read it via Tailwind's group selector.
   */
  triggerClassName?: string;
}

/**
 * Per-thread actions menu (rename / delete).
 *
 * The kebab button used to be hover-only via `opacity-0 group-hover:opacity-100`,
 * which made it effectively invisible on touch devices. We now always render
 * the trigger; CSS in the parent decides whether to fade it in on hover (md+)
 * or keep it visible (touch).
 *
 * Confirmation flows use shadcn `<AlertDialog>` (delete) and `<Dialog>` +
 * `<Input>` (rename) instead of `window.confirm` / `window.prompt`, which
 * looked unbranded and ignored the dark theme.
 */
export function ChatRowActions({
  threadTitle,
  open,
  onOpenChange,
  onRename,
  onDelete,
  triggerClassName,
}: ChatRowActionsProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(threadTitle);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Keep the rename field in sync if the title is changed elsewhere
  // (e.g. the agent renames the thread mid-chat).
  useEffect(() => {
    if (!renameOpen) setRenameValue(threadTitle);
  }, [threadTitle, renameOpen]);

  const handleRenameSubmit = async () => {
    const next = renameValue.trim();
    if (!next || next === threadTitle) {
      setRenameOpen(false);
      return;
    }
    setRenameSubmitting(true);
    try {
      await onRename(next);
      setRenameOpen(false);
    } finally {
      setRenameSubmitting(false);
    }
  };

  const handleDeleteSubmit = async () => {
    setDeleteSubmitting(true);
    try {
      await onDelete();
      setDeleteOpen(false);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground",
              "transition-opacity hover:bg-background/50 hover:text-foreground",
              "data-[state=open]:opacity-100",
              triggerClassName,
            )}
            aria-label="Chat actions"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-44"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() => {
              onOpenChange(false);
              setRenameValue(threadTitle);
              setRenameOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-destructive focus:text-destructive"
            onClick={() => {
              onOpenChange(false);
              setDeleteOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={renameOpen}
        onOpenChange={(o) => {
          if (!renameSubmitting) setRenameOpen(o);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onOpenAutoFocus={() => {
            // RAF so the input is mounted before we focus / select.
            requestAnimationFrame(() => {
              renameInputRef.current?.focus();
              renameInputRef.current?.select();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>
              Give this conversation a clearer name so you can find it later.
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleRenameSubmit();
              }
            }}
            placeholder="Chat name"
            disabled={renameSubmitting}
            autoFocus
            maxLength={120}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                disabled={renameSubmitting}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => void handleRenameSubmit()}
              disabled={
                renameSubmitting ||
                !renameValue.trim() ||
                renameValue.trim() === threadTitle
              }
            >
              {renameSubmitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          if (!deleteSubmitting) setDeleteOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <strong>{threadTitle}</strong>, every
              message in it, and the agent&apos;s memory of the conversation.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubmitting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteSubmit();
              }}
              disabled={deleteSubmitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/40"
            >
              {deleteSubmitting ? "Deleting…" : "Delete chat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
