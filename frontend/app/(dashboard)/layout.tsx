"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  MessageSquare,
  Search,
  Archive,
  ChevronDown,
  Menu,
  User,
  Settings,
  LogOut,
  Sun,
  Moon,
  GraduationCap,
  Home,
} from "lucide-react";
import { logout } from "../(auth)/actions";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { UserProvider, useUser } from "@/context/user-context";

interface SidebarContentProps {
  setIsSidebarOpen: (open: boolean) => void;
}

const SidebarContent = ({ setIsSidebarOpen }: SidebarContentProps) => {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { userDetails, loading } = useUser();

  useEffect(() => {
    setMounted(true);
  }, []);

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
      <nav className="flex flex-col gap-0.5 px-2">
        <Link
          href="/new"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium hover:bg-sidebar-accent transition-colors"
        >
          <Home className="h-4 w-4" />
          <span>Home</span>
        </Link>
        <button
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium hover:bg-sidebar-accent transition-colors text-left"
        >
          <Search className="h-4 w-4" />
          <span>Search</span>
        </button>
        <button
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium hover:bg-sidebar-accent transition-colors text-left"
        >
          <Archive className="h-4 w-4" />
          <span>Archived</span>
        </button>
      </nav>

      {/* New Chat Button */}
      <div className="px-2 pt-5">
        <Link href="/new">
          <Button className="w-full justify-center gap-2 rounded-lg h-9 text-sm font-semibold bg-secondary text-secondary-foreground hover:bg-secondary/90 shadow-sm">
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
          <div className="flex flex-col gap-0.5">
            {[
              { title: "The causes of World War I", active: true },
              { title: "Solving quadratic equations", active: false },
              { title: "Basics of cellular respiration", active: false },
              { title: "French Revolution key figures", active: false },
            ].map((chat, i) => (
              <Link
                key={i}
                href="#"
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  chat.active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span className="truncate">{chat.title}</span>
              </Link>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-2 border-t border-sidebar-border pt-4 px-2">
        {/* Theme Toggle */}
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-xs font-medium text-muted-foreground">Theme</span>
          {mounted && (
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? (
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
          )}
        </div>

        {/* User Profile */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg hover:bg-sidebar-accent transition-colors text-left">
              <div className="size-8 min-w-8 rounded-full bg-primary/15 flex items-center justify-center overflow-hidden">
                {userDetails?.avatarUrl ? (
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
            <DropdownMenuItem className="cursor-pointer gap-2">
              <User className="h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer gap-2">
              <Settings className="h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
        <div className="flex h-screen w-full bg-background text-foreground">
          {/* Desktop Sidebar */}
          <aside 
            className={cn(
              "hidden md:flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out overflow-hidden",
              isSidebarOpen ? "w-[260px]" : "w-0 border-r-0"
            )}
          >
            <div className="w-[260px] p-4 h-full">
              <SidebarContent setIsSidebarOpen={setIsSidebarOpen} />
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex flex-1 flex-col h-screen overflow-hidden relative">
            {/* Mobile Header */}
            <header className="flex md:hidden items-center justify-between px-4 py-3 border-b border-border bg-background">
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

            {children}
          </main>
        </div>
      </TooltipProvider>
    </UserProvider>
  );
}
