"use client";

import * as React from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { MoonStar, Sun, Menu, LogIn, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#testimonials", label: "Testimonials" },
  { href: "#pricing", label: "Pricing" },
];

export function SiteHeader() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = mounted && theme === "dark";

  return (
    <header className="sticky top-0 z-50 h-16 w-full border-b bg-background/80 px-4 backdrop-blur transition-all duration-300 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 border-x px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="rounded-lg bg-primary p-1.5">
            <GraduationCap className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold">BacPrep AI</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="inline-flex h-9 items-center justify-center rounded-md bg-transparent px-3 py-1.5 text-base font-medium text-muted-foreground outline-none transition-colors hover:text-primary focus:text-primary"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="relative size-10"
            aria-label="Toggle theme"
          >
            <MoonStar
              className={cn("size-5 transition-all", isDark ? "scale-0" : "scale-100")}
            />
            <Sun
              className={cn(
                "absolute size-5 transition-all",
                isDark ? "scale-100" : "scale-0",
              )}
            />
            <span className="sr-only">Toggle theme</span>
          </Button>

          <Button variant="secondary" size="lg" className="max-sm:hidden" asChild>
            <Link href="/signup">Sign up</Link>
          </Button>

          <Button variant="secondary" size="icon" className="sm:hidden" asChild>
            <Link href="/signup">
              <LogIn className="size-5" />
              <span className="sr-only">Sign up</span>
            </Link>
          </Button>

          <Button
            variant="secondary"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen((s) => !s)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <Menu className="size-5" />
            <span className="sr-only">Open menu</span>
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden">
          <div className="mx-auto max-w-7xl border-x bg-background px-4 py-4 sm:px-6 lg:px-8">
            <nav className="flex flex-col gap-1">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md px-3 py-2 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="rounded-md px-3 py-2 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Login
              </Link>
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
