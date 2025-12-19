"use client";

import Link from "next/link";
import * as React from "react";
import { useTheme } from "next-themes";
import { Menu, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-background text-foreground">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 w-full bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto flex h-20 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="size-6 text-primary">
              <svg
                fill="none"
                viewBox="0 0 48 48"
                xmlns="http://www.w3.org/2000/svg"
                className="h-full w-full"
              >
                <path
                  clipRule="evenodd"
                  d="M12.0799 24L4 19.2479L9.95537 8.75216L18.04 13.4961L18.0446 4H29.9554L29.96 13.4961L38.0446 8.75216L44 19.2479L35.92 24L44 28.7521L38.0446 39.2479L29.96 34.5039L29.9554 44H18.0446L18.04 34.5039L9.95537 39.2479L4 28.7521L12.0799 24Z"
                  fill="currentColor"
                  fillRule="evenodd"
                ></path>
              </svg>
            </div>
            <h2 className="text-xl font-bold font-body">BacPrep AI</h2>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <a
              className="text-sm font-medium transition-colors hover:text-primary"
              href="#"
            >
              Features
            </a>
            <a
              className="text-sm font-medium transition-colors hover:text-primary"
              href="#"
            >
              Pricing
            </a>
            <Link
              className="text-sm font-medium transition-colors hover:text-primary"
              href="/login"
            >
              Login
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/signup">
              <Button
                className="hidden md:flex min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-10 px-4 bg-primary text-primary-foreground text-sm font-bold leading-normal tracking-wide transition-transform hover:scale-105 hover:bg-primary/90"
              >
                <span className="truncate">Try for Free</span>
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {mounted && theme === "dark" ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
              <span className="sr-only">Toggle theme</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 md:hidden"
            >
              <Menu className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </header>
      {/* Main Content */}
      <main className="flex-grow">
        {/* Full Viewport Hero Section */}
        <div className="flex h-[calc(100vh-80px)] min-h-[600px] w-full items-center justify-center">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center gap-8 text-center">
              <div className="flex flex-col gap-4">
                <h1 className="font-display text-5xl font-bold leading-tight text-foreground sm:text-6xl md:text-7xl lg:text-8xl">
                  Ace Your Exams, Effortlessly.
                </h1>
                <h2 className="max-w-2xl text-base font-normal text-muted-foreground md:text-lg">
                  BacPrep AI is your personal AI tutor for exam preparation. Get
                  ahead with intelligent, adaptive learning.
                </h2>
              </div>
              <Link href="/signup">
                <Button
                  className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-lg h-12 px-6 bg-primary text-primary-foreground text-base font-bold leading-normal tracking-wide transition-transform hover:scale-105 hover:bg-primary/90"
                >
                  <span className="truncate">Start Studying Now</span>
                </Button>
              </Link>
              <p className="text-sm font-normal text-muted-foreground/80">
                Trusted by 10,000+ students
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
