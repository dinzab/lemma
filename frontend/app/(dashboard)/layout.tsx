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
  Archive,
  Sparkles,
  Plus,
  Folder,
  Pin,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { UserProvider, useUser } from "@/context/user-context";
import { deleteThread, getUserThreads, renameThread, type Thread } from "@/lib/api/threads";
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
  open: boolean;
  onToggle: () => void;
  trailing?: React.ReactNode;
}

function SectionHeader({ label, open, onToggle, trailing }: SectionHeaderProps) {
  return (
    <div className="group flex items-center gap-1 px-3 pb-1 pt-1.5">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
          <span className="truncate">{label}</span>
        </button>
      </CollapsibleTrigger>
      {trailing && (
        <div className="opacity-0 transition-opacity group-hover:opacity-100">
          {trailing}
        </div>
      )}
    </div>
  );
}

const projectsPlaceholders = [
  "Math notebook",
  "Science notes",
  "Philosophy ideas",
];

const SidebarContent = ({ setIsSidebarOpen }: SidebarContentProps) => {
  const { setTheme, theme } = useTheme();
  const { userDetails, loading } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [chatsOpen, setChatsOpen] = useState(true);

  const refreshThreads = useCallback(async () => {
    try {
      setIsLoadingThreads(true);
      const page = await getUserThreads(1, 30);
      setThreads(page.threads);
    } catch {
      toast.error("Could not load recent chats");
    } finally {
      setIsLoadingThreads(false);
    }
  }, []);

  useEffect(() => {
    refreshThreads();
  }, [refreshThreads, pathname]);

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
  const currentTheme = theme === "dark" ? "dark" : "light";
  const onHome = pathname === "/new";

  const handleRenameThread = async (thread: Thread) => {
    const nextTitle = window.prompt("Rename chat", thread.title);
    if (!nextTitle || nextTitle.trim() === thread.title) return;

    try {
      const updated = await renameThread(thread.id, nextTitle.trim());
      setThreads((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast.success("Chat renamed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename chat");
    }
  };

  const handleDeleteThread = async (thread: Thread) => {
    if (!window.confirm(`Delete "${thread.title}"?`)) return;

    try {
      await deleteThread(thread.id);
      setThreads((current) => current.filter((item) => item.id !== thread.id));
      toast.success("Chat deleted");
      if (activeThreadId === thread.id) {
        router.push("/new");
      }
    } catch {
      toast.error("Failed to delete chat");
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
        <NavRow icon={Archive} label="Archived" />
        <NavRow icon={Sparkles} label="Upgrade" badge="New" />
      </nav>

      {/* Scrollable sections */}
      <ScrollArea className="mt-3 flex-1 px-2">
        <div className="flex flex-col gap-1">
          {/* Projects */}
          <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
            <SectionHeader
              label="Projects"
              open={projectsOpen}
              onToggle={() => setProjectsOpen((v) => !v)}
              trailing={
                <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  aria-label="New project"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              }
            />
            <CollapsibleContent>
              <div className="flex flex-col gap-0.5">
                {projectsPlaceholders.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent/70"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{name}</span>
                  </button>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Pinned chats */}
          <Collapsible open={pinnedOpen} onOpenChange={setPinnedOpen}>
            <SectionHeader
              label="Pinned chats"
              open={pinnedOpen}
              onToggle={() => setPinnedOpen((v) => !v)}
            />
            <CollapsibleContent>
              <div className="px-3 py-1 text-xs leading-relaxed text-muted-foreground/80">
                Pin a chat to keep it handy.
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Your chats (real threads) */}
          <Collapsible open={chatsOpen} onOpenChange={setChatsOpen}>
            <SectionHeader
              label="Your chats"
              open={chatsOpen}
              onToggle={() => setChatsOpen((v) => !v)}
            />
            <CollapsibleContent>
              <div className="flex flex-col gap-0.5">
                {isLoadingThreads && (
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

                {threads.map((chat) => {
                  const isActive = activeThreadId === chat.id;
                  return (
                    <div
                      key={chat.id}
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

                      <DropdownMenu
                        open={activeMenuId === chat.id}
                        onOpenChange={(open) => setActiveMenuId(open ? chat.id : null)}
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            className="mr-1 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/50 hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
                            aria-label="Chat actions"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            className="cursor-pointer gap-2"
                            onClick={() => handleRenameThread(chat)}
                          >
                            <Pencil className="h-4 w-4" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem className="cursor-pointer gap-2">
                            <Pin className="h-4 w-4" />
                            Pin chat
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="cursor-pointer gap-2 text-destructive focus:text-destructive"
                            onClick={() => handleDeleteThread(chat)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
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
      <TooltipProvider>
        <div className="fixed inset-0 flex w-full overflow-hidden bg-background text-foreground">
          {/* Desktop Sidebar */}
          <aside
            className={cn(
              "relative z-10 hidden flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out md:flex",
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
                <SheetContent side="left" className="w-[272px] border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground">
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
    </UserProvider>
  );
}
