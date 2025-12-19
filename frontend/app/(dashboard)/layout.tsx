"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { 
  Library, 
  PanelLeftClose, 
  PanelLeftOpen,
  Plus, 
  MessageSquare, 
  FolderOpen, 
  Code, 
  ArrowUpRight, 
  ChevronDown,
  Menu,
  User,
  Settings,
  LogOut,
  Sun,
  Moon
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
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="bg-primary rounded-lg p-2">
            <Library className="text-primary-foreground h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-bold text-sidebar-foreground">BacPrep AI</h1>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="hidden md:flex hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => setIsSidebarOpen(false)}
        >
          <PanelLeftClose className="h-5 w-5" />
        </Button>
      </div>

      {/* New Chat Button */}
      <Link href="/new">
        <Button className="w-full justify-start gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="h-5 w-5" />
          <span className="truncate">New Chat</span>
        </Button>
      </Link>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 mt-4">
        <Link
          href="#"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <MessageSquare className="h-5 w-5 fill-current" />
          <span>Chats</span>
        </Link>
        <Link
          href="#"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <FolderOpen className="h-5 w-5" />
          <span>Projects</span>
        </Link>
        <Link
          href="#"
          className="flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <div className="flex items-center gap-3">
            <Code className="h-5 w-5" />
            <span>Code</span>
          </div>
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </nav>

      {/* Recents */}
      <div className="flex-grow flex flex-col overflow-hidden mt-4">
        <p className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider px-3 pt-4 pb-2">
          Recents
        </p>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-1 pr-3">
            <Link
              href="#"
              className="flex items-center gap-3 px-3 py-2 rounded-md bg-primary/10 text-primary"
            >
              <MessageSquare className="h-5 w-5" />
              <p className="text-sm font-medium truncate flex-1">
                The causes of World War I
              </p>
            </Link>
            <Link
              href="#"
              className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <MessageSquare className="h-5 w-5" />
              <p className="text-sm font-medium truncate flex-1">
                Solving quadratic equations
              </p>
            </Link>
            <Link
              href="#"
              className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <MessageSquare className="h-5 w-5" />
              <p className="text-sm font-medium truncate flex-1">
                Basics of cellular respiration
              </p>
            </Link>
            <Link
              href="#"
              className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            >
              <MessageSquare className="h-5 w-5" />
              <p className="text-sm font-medium truncate flex-1">
                French Revolution key figures
              </p>
            </Link>
          </div>
        </ScrollArea>
      </div>

      {/* Footer: Theme Toggle & User Profile */}
      <div className="flex flex-col gap-2 border-t border-sidebar-border pt-4">
        <div className="flex items-center justify-between px-2">
           <span className="text-xs font-medium text-muted-foreground">Theme</span>
           {mounted && (
             <Button
               variant="ghost"
               size="icon"
               className="h-8 w-8 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
               onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
             >
               {theme === "dark" ? (
                 <Sun className="h-4 w-4" />
               ) : (
                 <Moon className="h-4 w-4" />
               )}
               <span className="sr-only">Toggle theme</span>
             </Button>
           )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center justify-between w-full p-2 h-auto hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="size-8 min-w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground overflow-hidden">
                  {userDetails?.avatarUrl ? (
                    <img src={userDetails.avatarUrl} alt={fullName} className="h-full w-full object-cover" />
                  ) : (
                    <span className="font-semibold text-xs">{getInitials(fullName)}</span>
                  )}
                </div>
                <div className="flex flex-col items-start overflow-hidden">
                  <p className="text-sm font-semibold truncate w-full text-left">
                    {loading ? "..." : truncate(fullName, 15)}
                  </p>
                  <p className="text-xs text-muted-foreground truncate w-full text-left">
                    {loading ? "..." : "Free Plan"}
                  </p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 flex-shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56" side="top">
            <DropdownMenuItem className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              <span>Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" onClick={() => logout()}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sign out</span>
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
      <div className="flex h-screen w-full bg-background text-foreground">
        {/* Desktop Sidebar */}
        <aside 
          className={cn(
            "hidden md:flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out overflow-hidden",
            isSidebarOpen ? "w-72" : "w-0 border-r-0"
          )}
        >
          <div className="w-72 p-4 h-full">
             <SidebarContent setIsSidebarOpen={setIsSidebarOpen} />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex flex-1 flex-col h-screen overflow-hidden relative">
          {/* Mobile Header */}
          <header className="flex md:hidden items-center justify-between p-4 border-b border-border bg-background">
            <div className="flex items-center gap-3">
              <div className="bg-primary rounded-lg p-2">
                <Library className="text-primary-foreground h-6 w-6" />
              </div>
              <h1 className="font-display text-2xl font-bold">BacPrep AI</h1>
            </div>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-4 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
                <SheetHeader className="sr-only">
                  <SheetTitle>Navigation Menu</SheetTitle>
                </SheetHeader>
                <SidebarContent setIsSidebarOpen={setIsSidebarOpen} />
              </SheetContent>
            </Sheet>
          </header>

          {/* Desktop Sidebar Trigger (when closed) */}
          {!isSidebarOpen && (
            <div className="hidden md:block absolute top-4 left-4 z-50">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setIsSidebarOpen(true)}
                className="hover:bg-muted"
              >
                <PanelLeftOpen className="h-6 w-6" />
              </Button>
            </div>
          )}

          {children}
        </main>
      </div>
    </UserProvider>
  );
}
