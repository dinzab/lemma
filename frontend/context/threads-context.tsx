"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { getUserThreads, type Thread } from "@/lib/api/threads";

type ThreadsContextValue = {
  /** All threads loaded so far across all paginated requests. */
  threads: Thread[];
  /** Total threads the server reports (drives `hasMore`). */
  total: number;
  /** True only during the very first fetch — suppresses spinner on background refreshes. */
  isLoading: boolean;
  /** True while a `loadMore()` is in flight. */
  isLoadingMore: boolean;
  /** Whether more pages remain on the server. */
  hasMore: boolean;
  /** Load the next page of threads and append (de-duped) to the list. */
  loadMore: () => Promise<void>;
  /** Re-fetch page 1 and merge with already-loaded older pages. */
  refresh: () => Promise<void>;
  /** Optimistic local update after a successful rename. */
  applyRename: (thread: Thread) => void;
  /** Optimistic local removal after a successful delete (decrements `total`). */
  removeThread: (threadId: string) => void;
};

const PAGE_SIZE = 20;

const ThreadsContext = createContext<ThreadsContextValue | undefined>(undefined);

/**
 * Holds the sidebar's "Your chats" list at the dashboard-layout level so it
 * survives mounts/unmounts of `SidebarContent`. The mobile sidebar lives inside
 * a Radix `<Sheet>`, which unmounts `SheetContent` every time it closes — if
 * the threads state lived inside `SidebarContent`, every open re-fetched the
 * list from the API and reset the scroll position.
 *
 * Pagination model:
 * - Initial fetch: page 1, 20 threads. Sets `hasMore` = `total > threads.length`.
 * - `loadMore()` increments `page` and appends the next 20.
 * - `refresh()` (fired on pathname change) re-fetches page 1 and merges it on
 *   top of the existing list, preserving any deeper pages the user has already
 *   loaded so navigating to a new chat doesn't reset their pagination scroll.
 */
export function ThreadsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // A single in-flight ref guards both refresh and loadMore so a fast user
  // (rapidly opening the mobile sheet, scrolling the sentinel into view) can't
  // queue duplicate API calls.
  const inFlightRef = useRef(false);
  const hasFetchedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const isInitial = !hasFetchedRef.current;
    if (isInitial) setIsLoading(true);
    try {
      const result = await getUserThreads(1, PAGE_SIZE);
      hasFetchedRef.current = true;
      setThreads((current) => {
        if (current.length === 0) return result.threads;
        // Merge: refreshed page 1 wins for any duplicate ids; everything we
        // had loaded from deeper pages stays in place behind it.
        const refreshedIds = new Set(result.threads.map((t) => t.id));
        const tail = current.filter((t) => !refreshedIds.has(t.id));
        return [...result.threads, ...tail];
      });
      setPage((p) => (p < 1 ? 1 : p));
      setTotal(result.total);
    } catch {
      toast.error("Could not load recent chats");
    } finally {
      if (isInitial) setIsLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!hasFetchedRef.current) return;
    if (threads.length >= total) return;
    inFlightRef.current = true;
    setIsLoadingMore(true);
    try {
      const next = page + 1;
      const result = await getUserThreads(next, PAGE_SIZE);
      setThreads((current) => {
        const seen = new Set(current.map((t) => t.id));
        const additions = result.threads.filter((t) => !seen.has(t.id));
        return [...current, ...additions];
      });
      setPage(next);
      setTotal(result.total);
    } catch {
      toast.error("Could not load more chats");
    } finally {
      setIsLoadingMore(false);
      inFlightRef.current = false;
    }
  }, [page, threads.length, total]);

  // Re-fetch page 1 whenever the route changes inside the dashboard. New
  // threads appear at the top, renames propagate, and deeper pages stay put
  // (see `refresh` for the merge semantics).
  useEffect(() => {
    refresh();
  }, [refresh, pathname]);

  const applyRename = useCallback((thread: Thread) => {
    setThreads((current) =>
      current.map((item) => (item.id === thread.id ? thread : item)),
    );
  }, []);

  const removeThread = useCallback((threadId: string) => {
    setThreads((current) => current.filter((item) => item.id !== threadId));
    setTotal((t) => Math.max(0, t - 1));
  }, []);

  const hasMore = threads.length < total;

  return (
    <ThreadsContext.Provider
      value={{
        threads,
        total,
        isLoading,
        isLoadingMore,
        hasMore,
        loadMore,
        refresh,
        applyRename,
        removeThread,
      }}
    >
      {children}
    </ThreadsContext.Provider>
  );
}

export function useThreads() {
  const context = useContext(ThreadsContext);
  if (context === undefined) {
    throw new Error("useThreads must be used within a ThreadsProvider");
  }
  return context;
}
