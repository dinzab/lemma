"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Languages, TimerReset } from "lucide-react";

import { createThread, extractTitleFromMessage } from "@/lib/api/threads";
import { useUser } from "@/context/user-context";
import {
  PromptComposer,
  type PromptComposerMode,
} from "@/components/chat/PromptComposer";
import { TUTOR_CAPABILITY_TABS } from "@/components/landing/tutor-capability-tabs";
import { cn } from "@/lib/utils";

const DEFAULT_PLACEHOLDER =
  "Example: Explain derivatives from the Bac Math section…";

const CAPABILITY_PLACEHOLDERS: Record<string, string> = TUTOR_CAPABILITY_TABS.reduce(
  (acc, tab) => {
    acc[tab.id] = `Example: ${tab.prefillPrompt}`;
    return acc;
  },
  {} as Record<string, string>,
);

export default function NewChatPage() {
  const router = useRouter();
  const { userDetails } = useUser();
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Currently-selected capability chip inside the composer. Drives the
  // composer placeholder text and the chip-active styling.
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string | null>(
    null,
  );

  // Map TUTOR_CAPABILITY_TABS into the PromptComposer's `modes` shape. Using
  // `shortLabel` keeps the chip strip from overflowing at small viewports.
  const capabilityModes: PromptComposerMode[] = useMemo(
    () =>
      TUTOR_CAPABILITY_TABS.map((tab) => ({
        id: tab.id,
        label: tab.shortLabel ?? tab.label,
        icon: tab.icon,
      })),
    [],
  );

  const placeholder = selectedCapabilityId
    ? CAPABILITY_PLACEHOLDERS[selectedCapabilityId] ?? DEFAULT_PLACEHOLDER
    : DEFAULT_PLACEHOLDER;

  const firstName = userDetails?.fullName?.split(" ")[0] || "there";

  const handleSelectCapability = (id: string) => {
    // Click an active chip = deselect (and clear the prefilled prompt if it
    // hasn't been edited away). Otherwise activate the chip and prefill the
    // composer with the capability's example.
    const tab = TUTOR_CAPABILITY_TABS.find((t) => t.id === id);
    if (!tab) return;

    setSelectedCapabilityId((current) => {
      if (current === id) {
        // Deselecting the active chip — clear the message only if it still
        // matches the prefill (don't blow away the user's own edits).
        setMessage((prev) => (prev === tab.prefillPrompt ? "" : prev));
        return null;
      }
      // Activating a chip — prefill the composer with this capability's
      // example so the student sees a concrete starting point.
      setMessage(tab.prefillPrompt);
      return id;
    });
  };

  const handleSendMessage = async () => {
    if (!message.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const title = extractTitleFromMessage(message, 50);
      const thread = await createThread(title);
      sessionStorage.setItem(`thread_${thread.id}_initial_message`, message);
      router.push(`/c/${thread.id}`);
    } catch (err) {
      console.error("Failed to create thread:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to create thread. Please try again.",
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="no-scrollbar relative flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Top toolbar — inline at the top on mobile, absolute-positioned on
          ≥sm so it doesn't steal vertical space from the centered composer. */}
      <div className="flex items-center justify-end gap-2 px-4 pt-3 sm:absolute sm:right-6 sm:top-5 sm:z-10 sm:px-0 sm:pt-0">
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors sm:px-3 sm:py-1.5 sm:text-xs",
            "hover:bg-primary/15",
          )}
        >
          <TimerReset className="h-3.5 w-3.5" />
          temporary chat
        </button>
        <button
          type="button"
          aria-label="Change language"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <Languages className="h-4 w-4" />
        </button>
      </div>

      {/* Centered hero + composer column. The composer is the focal point;
          we vertically center the column inside the page so it sits in the
          middle of the screen. */}
      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-4 pb-10 pt-6 text-center sm:max-w-3xl sm:gap-8 sm:px-6 sm:pt-12 lg:max-w-4xl lg:px-8">
        {/* Hero */}
        <div className="flex flex-col items-center gap-3 sm:gap-4">
          <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span className="font-semibold uppercase tracking-wide text-primary">
              AI Tutor
            </span>
            <span className="hidden h-3 w-px bg-border/70 sm:inline-block" aria-hidden />
            <span className="hidden sm:inline">Ready for today&apos;s Bac session</span>
          </span>

          <h1 className="max-w-3xl text-balance text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl lg:text-[2.875rem]">
            Hello{" "}
            <span className="bg-gradient-to-br from-primary via-chart-3 to-secondary bg-clip-text text-transparent">
              {firstName}
            </span>
            , what should we master today?
          </h1>
          <p className="max-w-2xl text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
            Pick a capability to prefill an example, or just ask anything.
          </p>
        </div>

        {/* Composer. Capability chips live inside it (replacing the previous
            three generic mode chips) so the input is the only thing the
            student needs to interact with. */}
        <div className="w-full">
          <PromptComposer
            value={message}
            onChange={setMessage}
            onSubmit={handleSendMessage}
            placeholder={placeholder}
            isSubmitting={isLoading}
            modes={capabilityModes}
            selectedModeId={selectedCapabilityId ?? undefined}
            onSelectMode={handleSelectCapability}
            size="hero"
            autoFocus
          />

          {error && (
            <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-left text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
