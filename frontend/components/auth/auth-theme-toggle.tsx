"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { MoonStar, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AuthThemeToggle({ className }: { className?: string }) {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);
    const isDark = mounted && theme === "dark";

    return (
        <Button
            variant="outline"
            size="icon"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className={cn("relative size-10", className)}
            aria-label="Toggle theme"
        >
            <MoonStar
                className={cn(
                    "size-5 transition-all",
                    isDark ? "scale-0" : "scale-100",
                )}
            />
            <Sun
                className={cn(
                    "absolute size-5 transition-all",
                    isDark ? "scale-100" : "scale-0",
                )}
            />
            <span className="sr-only">Toggle theme</span>
        </Button>
    );
}
