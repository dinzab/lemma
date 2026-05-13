"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Menu,
  LogOut,
  Sun,
  Moon,
  GraduationCap,
  Home,
  Search,
  Settings,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { logout } from "../(auth)/actions";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatRowActions } from "@/components/chat/ChatRowActions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { UserProvider, useUser } from "@/context/user-context";
import { ThreadsProvider, useThreads } from "@/context/threads-context";
import { deleteThread, renameThread, type Thread } from "@/lib/api/threads";
import { groupThreadsByRecency } from "@/lib/group-threads";
import { toast } from "sonner";

interface SidebarContentProps {
  setIsSidebarOpen: (open: boolean) => void;
}

interface NavRowProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  active?: boolean;
  onClick?: () => void;
  badge?: string;
}

function NavRow({ icon: Icon, label, href, active, onClick, badge }: NavRowProps) {
  const className = cn(
    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
    active
      ? "bg-sidebar-accent text-sidebar-foreground font-semibold"
      : "text-sidebar-foreground/85 hover:bg-sidebar-accent/70",
  );

  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate text-left">{label}</span>
      {badge && (
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
          {badge}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

interface SectionHeaderProps {
  label: string;
  count?: number;
  trailing?: React.ReactNode;
}

/**
 * Section header that lives inside a `<Collapsible>`. The chevron's rotation
 * is driven entirely by Radix's `data-state` attribute on the trigger button
 * (via the `group` class), so the parent doesn't need to mirror open/close
 * state — each `<Collapsible>` can stay uncontrolled.
 */
function SectionHeader({ label, count, trailing }: SectionHeaderProps) {
  return (
    <div className="group/section flex items-center gap-1 px-3 pb-1 pt-1.5">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex flex-1 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className="h-3 w-3 transition-transform group-data-[state=closed]:-rotate-90" />
          <span className="truncate">{label}</span>
          {typeof count === "number" && count > 0 && (
            <span className="ml-1 rounded-full bg-sidebar-accent/60 px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-muted-foreground">
              {count}
            </span>
          )}
        </button>
      </CollapsibleTrigger>
      {trailing && (
        <div className="opacity-0 transition-opacity group-hover/section:opacity-100">
          {trailing}
        </div>
      )}
    </div>
  );
}

interface ThreadRowProps {
  chat: Thread;
  isActive: boolean;
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onRename: (chat: Thread, nextTitle: string) => Promise<void>;
  onDelete: (chat: Thread) => Promise<void>;
}

function ThreadRow({
  chat,
  isActive,
  isMenuOpen,
  onMenuOpenChange,
  onRename,
  onDelete,
}: ThreadRowProps) {
  return (
    <div
      className={cn(
        "group relative flex items-center rounded-lg text-sm transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-foreground font-semibold"
          : "text-sidebar-foreground/85 hover:bg-sidebar-accent/70",
      )}
    >
      <Link
        href={`/c/${chat.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-1.5"
      >
        <MessageSquare
          className={cn(
            "h-4 w-4 shrink-0",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="truncate">{chat.title}</span>
      </Link>

      {/*
        Trigger visibility:
        - On touch (no hover) we keep it at full opacity so the user actually
          sees an affordance to delete / rename. Tailwind's `[@media(hover:hover)]`
          variant fades it in only on devices that report hover support.
        - On the active row we also keep it visible at full opacity even on
          desktop, so the currently-open chat always advertises its actions.
      */}
      <ChatRowActions
        threadTitle={chat.title}
        open={isMenuOpen}
        onOpenChange={onMenuOpenChange}
        onRename={(nextTitle) => onRename(chat, nextTitle)}
        onDelete={() => onDelete(chat)}
        triggerClassName={cn(
          "opacity-100",
          "[@media(hover:hover)]:opacity-0",
          "[@media(hover:hover)]:group-hover:opacity-100",
          isActive && "[@media(hover:hover)]:opacity-100",
        )}
      />
    </div>
  );
}

interface InfiniteSentinelProps {
  onIntersect: () => void;
  enabled: boolean;
  isLoadingMore: boolean;
}

/**
 * Triggers `onIntersect` when scrolled into view inside the sidebar's Radix
 * ScrollArea viewport. Resolves the viewport at runtime via `closest()` so
 * `IntersectionObserver` correctly observes the *inner* scroller — using the
 * default document root would fire spuriously because the ScrollArea uses
 * `overflow: hidden` rather than the document scroller.
 */
function InfiniteSentinel({ onIntersect, enabled, isLoadingMore }: InfiniteSentinelProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onIntersectRef = useRef(onIntersect);

  // Keep the latest callback in a ref so the IntersectionObserver effect below
  // can stay stable on `[enabled]` only — re-creating the observer on every
  // `loadMore` identity change would tear down/setup constantly.
  useEffect(() => {
    onIntersectRef.current = onIntersect;
  }, [onIntersect]);

  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node) return;

    const viewport =
      (node.closest('[data-slot="scroll-area-viewport"]') as HTMLElement | null) ?? null;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onIntersectRef.current();
        }
      },
      { root: viewport, rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);

  return (
    <div ref={ref} className="flex h-8 items-center justify-center px-3 text-xs text-muted-foreground">
      {isLoadingMore ? (
        <span className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading more
        </span>
      ) : (
        <span className="opacity-0">.</span>
      )}
    </div>
  );
}

const SidebarContent = ({ setIsSidebarOpen }: SidebarContentProps) => {
  const { setTheme, theme } = useTheme();
  const { userDetails, loading } = useUser();
  const {
    threads,
    isLoading: isLoadingThreads,
    isLoadingMore,
    hasMore,
    loadMore,
    applyRename,
    removeThread,
  } = useThreads();
  const pathname = usePathname();
  const router = useRouter();
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const getInitials = (name: string) => {
    if (!name) return "U";
    const parts = name.trim().split(" ");
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const truncate = (str: string, n: number) => {
    if (!str) return "";
    return str.length > n ? str.slice(0, n - 1) + "…" : str;
  };

  const fullName = userDetails?.fullName || "User";
  const activeThreadId = useMemo(
    () => (pathname?.startsWith("/c/") ? pathname.split("/")[2] : null),
    [pathname],
  );
  const threadGroups = useMemo(() => groupThreadsByRecency(threads), [threads]);
  const currentTheme = theme === "dark" ? "dark" : "light";
  const onHome = pathname === "/new";
  const onSettings = pathname === "/settings";

  const handleRenameThread = async (thread: Thread, nextTitle: string) => {
    try {
      const updated = await renameThread(thread.id, nextTitle);
      applyRename(updated);
      toast.success("Chat renamed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to rename chat",
      );
      throw error;
    }
  };

  const handleDeleteThread = async (thread: Thread) => {
    try {
      await deleteThread(thread.id);
      removeThread(thread.id);
      toast.success("Chat deleted");
      if (activeThreadId === thread.id) {
        router.push("/new");
      }
    } catch (error) {
      toast.error("Failed to delete chat");
      throw error;
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-2 pb-3">
        <Link href="/new" className="flex items-center gap-2">
          <div className="rounded-lg bg-primary p-1.5 shadow-sm shadow-primary/20">
            <GraduationCap className="text-primary-foreground h-4 w-4" />
          </div>
          <span className="text-base font-bold text-sidebar-foreground">BacPrep AI</span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:flex h-7 w-7 rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          onClick={() => setIsSidebarOpen(false)}
        >
          <PanelLeftClose className="h-4 w-4" />
          <span className="sr-only">Close sidebar</span>
        </Button>
      </div>

      {/* Primary navigation */}
      <nav className="flex flex-col gap-0.5 px-2">
        <NavRow icon={Home} label="Home" href="/new" active={onHome} />
        <NavRow icon={Search} label="Search" />
        <NavRow icon={Settings} label="Settings" href="/settings" active={onSettings} />
      </nav>

      {/* Scrollable sections */}
      <ScrollArea className="mt-3 min-h-0 flex-1 px-2">
        <div className="flex flex-col gap-1">
          {isLoadingThreads && threadGroups.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading chats
            </div>
          )}

          {!isLoadingThreads && threads.length === 0 && (
            <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground/80">
              Your conversations will appear here after the first message.
            </p>
          )}

          {threadGroups.map((group, idx) => (
            <Collapsible key={group.id} defaultOpen={idx === 0}>
              <SectionHeader label={group.label} count={group.threads.length} />
              <CollapsibleContent>
                <div className="flex flex-col gap-0.5">
                  {group.threads.map((chat) => (
                    <ThreadRow
                      key={chat.id}
                      chat={chat}
                      isActive={activeThreadId === chat.id}
                      isMenuOpen={activeMenuId === chat.id}
                      onMenuOpenChange={(open) =>
                        setActiveMenuId(open ? chat.id : null)
                      }
                      onRename={handleRenameThread}
                      onDelete={handleDeleteThread}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}

          {hasMore && threads.length > 0 && (
            <InfiniteSentinel
              enabled={hasMore}
              isLoadingMore={isLoadingMore}
              onIntersect={loadMore}
            />
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-2 pt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent">
              <div className="flex size-8 min-w-8 items-center justify-center overflow-hidden rounded-full border bg-primary/15">
                {userDetails?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={userDetails.avatarUrl} alt={fullName} className="h-full w-full object-cover" />
                ) : (
                  <span className="font-semibold text-xs text-primary">{getInitials(fullName)}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {loading ? "..." : truncate(fullName, 18)}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {loading ? "..." : userDetails?.email ? truncate(userDetails.email, 24) : "Free Plan"}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56" side="top">
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onClick={() => setTheme(currentTheme === "dark" ? "light" : "dark")}
              suppressHydrationWarning
            >
              {currentTheme === "dark" ? (
                <>
                  <Sun className="h-4 w-4" />
                  Switch to light mode
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4" />
                  Switch to dark mode
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer gap-2 text-destructive focus:text-destructive" onClick={() => logout()}>
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <UserProvider>
      <ThreadsProvider>
        <TooltipProvider>
          <div className="fixed inset-0 flex w-full overflow-hidden bg-background text-foreground">
            {/* Desktop Sidebar */}
            <aside
              className={cn(
                "relative z-10 hidden flex-col overflow-hidden border-r border-border/60 bg-transparent text-sidebar-foreground transition-all duration-300 ease-in-out md:flex",
                isSidebarOpen ? "w-[272px]" : "w-0 border-r-0",
              )}
            >
              <div className="h-full w-[272px] p-3">
                <SidebarContent setIsSidebarOpen={setIsSidebarOpen} />
              </div>
            </aside>

            {/* Main Content */}
            <main className="relative z-10 flex h-full flex-1 flex-col overflow-hidden">
              {/* Mobile Header */}
              <header className="flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur-xl md:hidden">
                <Link href="/new" className="flex items-center gap-2.5">
                  <div className="rounded-lg bg-primary p-1.5">
                    <GraduationCap className="text-primary-foreground h-5 w-5" />
                  </div>
                  <span className="text-base font-bold">BacPrep AI</span>
                </Link>
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9">
                      <Menu className="h-5 w-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[272px] border-r border-border/60 bg-background p-3 text-sidebar-foreground">
                    <SheetHeader className="sr-only">
                      <SheetTitle>Navigation Menu</SheetTitle>
                    </SheetHeader>
                    <SidebarContent setIsSidebarOpen={setIsSidebarOpen} />
                  </SheetContent>
                </Sheet>
              </header>

              {/* Desktop Sidebar Toggle (when closed) */}
              {!isSidebarOpen && (
                <div className="absolute left-3 top-3 z-50 hidden md:block">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-lg hover:bg-muted"
                        onClick={() => setIsSidebarOpen(true)}
                      >
                        <PanelLeftOpen className="h-5 w-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Open sidebar</TooltipContent>
                  </Tooltip>
                </div>
              )}

              <div className="relative flex min-h-0 flex-1 flex-col">
                {children}
              </div>
            </main>
          </div>
        </TooltipProvider>
      </ThreadsProvider>
    </UserProvider>
  );
}
