"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

/**
 * One figure entry registered for the current conversation. Mirrors
 * the per-figure shape that the agent's `formatFiguresForLLM` /
 * `inspect_figure` / `show_question_assets` tools emit, keyed by
 * `<pair_id>:<side>:<index>`.
 *
 * The registry is the lookup table the inline `lemma:fig:…` chip uses
 * to render a clickable thumbnail next to the agent's prose, even
 * though the parent surface (`<QuestionCard>`, `<PastPaperChip>`,
 * `<QuestionAssetsBlock>`) lives a few message blocks away.
 *
 * `caption` is the LLM-generated French description; `alt` is the
 * accessible alt-text the chip renders on hover / for screen readers.
 */
export interface RegisteredFigure {
  url: string;
  alt: string;
  caption: string | null;
  shortLabel: string;
  label: string;
}

/**
 * Identifying triplet of one figure within one Bac question.
 *
 * `index` is 0-based on the wire (matches the citation's `ref_uri`)
 * and rendered as `index + 1` in human-facing labels.
 */
export interface FigureKey {
  pair_id: string;
  side: "enonce" | "corrige";
  index: number;
}

/**
 * Build the canonical registry key for a figure citation. Mirrors the
 * canonical
 * `lemma:fig:<exam_handle>:<exercise_handle>:<question_handle>:<side>:<index>`
 * URI grammar, but keyed on the full pair_id rather than the parsed
 * handles so registration sites (which already hold the pair_id)
 * don't have to re-parse.
 *
 * Legacy 4-segment URIs end up keyed as `<exam>:<exercise>:<side>:<index>`
 * (no question handle). Registration sites do *not* write under that
 * synthetic key any more, so legacy chips miss the registry and fall
 * through to the `/references/lemma` resolver.
 */
export function figureRegistryKey({
  pair_id,
  side,
  index,
}: FigureKey): string {
  return `${pair_id}:${side}:${index}`;
}

interface FigureRegistryContextValue {
  /** Register one figure under its canonical key. Idempotent. */
  registerFigure: (key: FigureKey, fig: RegisteredFigure) => void;
  /** Look up one figure by its key. Returns null when not registered. */
  getFigure: (key: FigureKey) => RegisteredFigure | null;
  /**
   * Reactive snapshot of the registry — components that render against
   * the registry (the inline figure chip in `MessageResponse`) read
   * this so they re-render when a new figure lands.
   */
  figures: ReadonlyMap<string, RegisteredFigure>;
}

const FigureRegistryContext = createContext<FigureRegistryContextValue | null>(
  null,
);

/**
 * Provider for the per-conversation figure registry.
 *
 * Mounted by `<LemmaConversation>` so every tool result rendered in
 * the conversation can register the figures it surfaces. The inline
 * `lemma:fig:…` chip in `<MessageResponse>` reads from this registry
 * to render a click-to-zoom thumbnail next to the prose.
 */
export function FigureRegistryProvider({ children }: { children: ReactNode }) {
  // We back the registry with a ref so registration calls during
  // render (cheap) don't trigger re-render storms, and a state map so
  // consumers re-render exactly when a new key lands. The state map
  // is a fresh `Map` on every change to keep referential stability of
  // the context value tight (otherwise every chip would re-render on
  // every keystroke).
  const ref = useRef<Map<string, RegisteredFigure>>(new Map());
  const [snapshot, setSnapshot] = useState<Map<string, RegisteredFigure>>(
    () => new Map(),
  );

  const registerFigure = useCallback(
    (key: FigureKey, fig: RegisteredFigure) => {
      const k = figureRegistryKey(key);
      const existing = ref.current.get(k);
      if (
        existing &&
        existing.url === fig.url &&
        existing.alt === fig.alt &&
        existing.caption === fig.caption
      ) {
        return;
      }
      ref.current.set(k, fig);
      // Defer the re-render to a microtask so registration during
      // render doesn't trigger a synchronous state update warning.
      Promise.resolve().then(() => {
        setSnapshot(new Map(ref.current));
      });
    },
    [],
  );

  const getFigure = useCallback(
    (key: FigureKey) => snapshot.get(figureRegistryKey(key)) ?? null,
    [snapshot],
  );

  const value = useMemo<FigureRegistryContextValue>(
    () => ({ registerFigure, getFigure, figures: snapshot }),
    [registerFigure, getFigure, snapshot],
  );

  return (
    <FigureRegistryContext.Provider value={value}>
      {children}
    </FigureRegistryContext.Provider>
  );
}

/**
 * Read the registry from a component. Safe to call outside the
 * provider — returns a no-op fallback so consumers don't crash on
 * surfaces that legitimately lack the registry (e.g. surfaces that
 * never render lemma: chips).
 */
export function useFigureRegistry(): FigureRegistryContextValue {
  const ctx = useContext(FigureRegistryContext);
  if (ctx) return ctx;
  return FALLBACK_REGISTRY;
}

const FALLBACK_REGISTRY: FigureRegistryContextValue = {
  registerFigure: () => undefined,
  getFigure: () => null,
  figures: new Map(),
};
