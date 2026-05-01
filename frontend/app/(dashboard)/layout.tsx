"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  MessageSquare,
  ChevronDown,
  Menu,
  LogOut,
  Sun,
  Moon,
  GraduationCap,
  Home,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
} from "lucide-react";
import { logout } from "../(auth)/actions";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { UserProvider, useUser } from "@/context/user-context";
import { deleteThread, getUserThreads, renameThread, type Thread } from "@/lib/api/threads";
import { toast } from "sonner";

interface SidebarContentProps {
  setIsSidebarOpen: (open: boolean) => void;
}

const SidebarContent = ({ setIsSidebarOpen }: SidebarContentProps) => {
  const { setTheme, theme } = useTheme();
  const { userDetails, loading } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

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
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const truncate = (str: string, n: number) => {
    if (!str) return "";
    return (str.length > n) ? str.slice(0, n-1) + '...' : str;
  };

  const fullName = userDetails?.fullName || "User";
  const activeThreadId = pathname?.startsWith("/c/") ? pathname.split("/")[2] : null;
  const currentTheme = theme === "dark" ? "dark" : "light";

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
      <div className="flex items-center justify-between px-2 pb-6">
        <Link href="/new" className="flex items-center gap-2.5">
          <div className="bg-primary rounded-lg p-1.5">
            <GraduationCap className="text-primary-foreground h-5 w-5" />
          </div>
          <span className="text-base font-bold text-sidebar-foreground">BacPrep AI</span>
        </Link>
        <Button 
          variant="ghost" 
          size="icon" 
          className="hidden md:flex h-8 w-8 rounded-lg hover:bg-sidebar-accent"
          onClick={() => setIsSidebarOpen(false)}
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Primary Navigation */}
      <nav className="flex flex-col gap-1 px-2">
        <Link
          href="/new"
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
            pathname === "/new"
              ? "bg-primary/10 text-primary shadow-sm"
              : "text-sidebar-foreground hover:bg-sidebar-accent"
          )}
        >
          <Home className="h-4 w-4" />
          <span>Study home</span>
        </Link>
      </nav>

      {/* New Chat Button */}
      <div className="px-2 pt-5">
        <Link href="/new">
          <Button className="w-full justify-center gap-2 rounded-xl h-10 text-sm font-bold bg-secondary text-secondary-foreground hover:bg-secondary/90 shadow-sm shadow-secondary/20">
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </Link>
      </div>

      {/* Recent Chats */}
      <div className="flex-grow flex flex-col overflow-hidden mt-6">
        <div className="flex items-center justify-between px-4 pb-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Recent chats
          </p>
        </div>
        <ScrollArea className="flex-1 px-2">
          <div className="flex flex-col gap-1">
            {isLoadingThreads && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading chats
              </div>
            )}

            {!isLoadingThreads && threads.length === 0 && (
              <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                Your conversations will appear here after the first message.
              </p>
            )}

            {threads.map((chat) => {
              const isActive = activeThreadId === chat.id;
              return (
                <div
                  key={chat.id}
                  className={cn(
                    "group relative flex items-center rounded-xl text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Link
                    href={`/c/${chat.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5"
                  >
                    <MessageSquare className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
                    <span className={cn("truncate", isActive && "font-semibold")}>{chat.title}</span>
                  </Link>

                  <DropdownMenu
                    open={activeMenuId === chat.id}
                    onOpenChange={(open) => setActiveMenuId(open ? chat.id : null)}
                  >
                    <DropdownMenuTrigger asChild>
                      <button className="mr-1 flex h-7 w-7 items-center justify-center rounded-lg opacity-0 transition-opacity hover:bg-background/50 group-hover:opacity-100 data-[state=open]:opacity-100">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Chat actions</span>
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
                      <DropdownMenuItem
                        className="cursor-pointer gap-2 text-destructive"
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
        </ScrollArea>
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-2 border-t border-sidebar-border pt-4 px-2">
        {/* Theme Toggle */}
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-xs font-medium text-muted-foreground">Theme</span>
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setTheme(currentTheme === "dark" ? "light" : "dark")}
            suppressHydrationWarning
          >
            {currentTheme === "dark" ? (
              <>
                <Sun className="h-3.5 w-3.5" />
                <span>Light</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5" />
                <span>Dark</span>
              </>
            )}
          </button>
        </div>

        {/* User Profile */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-sidebar-accent transition-colors text-left">
              <div className="size-8 min-w-8 rounded-full bg-primary/15 flex items-center justify-center overflow-hidden">
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
                  {loading ? "..." : (userDetails?.email ? truncate(userDetails.email, 22) : "Free Plan")}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56" side="top">
            <DropdownMenuItem className="cursor-pointer gap-2 text-destructive" onClick={() => logout()}>
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
        <div className="relative flex h-screen w-full overflow-hidden bg-background text-foreground">
          <div className="pointer-events-none absolute -left-24 top-0 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-secondary/20 blur-3xl" />
          {/* Desktop Sidebar */}
          <aside 
            className={cn(
              "relative z-10 hidden md:flex flex-col border-r border-sidebar-border bg-sidebar/85 text-sidebar-foreground backdrop-blur-xl transition-all duration-300 ease-in-out overflow-hidden",
              isSidebarOpen ? "w-[260px]" : "w-0 border-r-0"
            )}
          >
            <div className="w-[260px] p-4 h-full">
              <SidebarContent setIsSidebarOpen={setIsSidebarOpen} />
            </div>
          </aside>

          {/* Main Content */}
          <main className="relative z-10 flex flex-1 flex-col h-screen overflow-hidden">
            {/* Mobile Header */}
            <header className="flex md:hidden items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-xl">
              <Link href="/new" className="flex items-center gap-2.5">
                <div className="bg-primary rounded-lg p-1.5">
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
                <SheetContent side="left" className="w-[260px] p-4 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
                  <SheetHeader className="sr-only">
                    <SheetTitle>Navigation Menu</SheetTitle>
                  </SheetHeader>
                  <SidebarContent setIsSidebarOpen={setIsSidebarOpen} />
                </SheetContent>
              </Sheet>
            </header>

            {/* Desktop Sidebar Toggle (when closed) */}
            {!isSidebarOpen && (
              <div className="hidden md:block absolute top-3 left-3 z-50">
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
