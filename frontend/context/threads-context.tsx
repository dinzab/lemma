"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";

import { getUserThreads, type Thread } from "@/lib/api/threads";

type ThreadsContextValue = {
  threads: Thread[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  applyRename: (thread: Thread) => void;
  removeThread: (threadId: string) => void;
};

const ThreadsContext = createContext<ThreadsContextValue | undefined>(undefined);

/**
 * Holds the sidebar's "Your chats" list at the dashboard-layout level so it
 * survives mounts/unmounts of `SidebarContent`. The mobile sidebar lives inside
 * a Radix `<Sheet>`, which unmounts `SheetContent` every time it closes — if
 * the threads state lived inside `SidebarContent`, every open re-fetched the
 * list from the API and reset the scroll position. Lifting the state into a
 * provider keeps the data + scroll position stable across sheet toggles.
 */
export function ThreadsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      const page = await getUserThreads(1, 30);
      setThreads(page.threads);
    } catch {
      toast.error("Could not load recent chats");
    } finally {
      setIsLoading(false);
    }
  }, []);

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
  }, []);

  return (
    <ThreadsContext.Provider
      value={{ threads, isLoading, refresh, applyRename, removeThread }}
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
