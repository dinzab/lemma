"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { GraduationCap } from "lucide-react";
import { AuthDecorativePanel } from "./auth-decorative-panel";
import { AuthThemeToggle } from "./auth-theme-toggle";

/**
 * Shared 2-column shell for /login and /signup.
 *
 *  - Left:  decorative panel (lg+ only) — landing-page vibe.
 *  - Right: brand strip on top + form area + footer link.
 *
 * The form panel renders `children`, so individual auth pages only own
 * their form layout/state — the chrome (logo, theme toggle, footer link)
 * lives here so it stays consistent.
 */
export function AuthShell({
    panel,
    title,
    subtitle,
    footer,
    children,
}: {
    panel: { title: React.ReactNode; subtitle: string; badge: string };
    title: string;
    subtitle: string;
    footer: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="relative min-h-svh w-full bg-background text-foreground">
            <div className="grid min-h-svh w-full grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
                <AuthDecorativePanel
                    title={panel.title}
                    subtitle={panel.subtitle}
                    badge={panel.badge}
                />

                {/* Right column: form */}
                <div className="relative flex min-h-svh flex-col">
                    {/* Mobile-only top brand strip with subtle gradient */}
                    <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 top-0 hidden h-32 bg-gradient-to-b from-muted/40 to-transparent max-lg:block"
                    />

                    {/* Top bar: logo + theme toggle */}
                    <div className="relative z-10 flex items-center justify-between p-5 sm:p-6 lg:p-8">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2.5 text-base font-semibold"
                        >
                            <span className="rounded-lg bg-primary p-1.5">
                                <GraduationCap className="h-5 w-5 text-primary-foreground" />
                            </span>
                            BacPrep AI
                        </Link>
                        <AuthThemeToggle />
                    </div>

                    {/* Centered form */}
                    <div className="relative flex flex-1 items-center justify-center px-5 pb-10 sm:px-8">
                        <motion.div
                            initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                            transition={{ duration: 0.45 }}
                            className="w-full max-w-md"
                        >
                            <div className="mb-7">
                                <h1 className="text-3xl font-semibold tracking-tight sm:text-[2rem]">
                                    {title}
                                </h1>
                                <p className="mt-2 text-base text-muted-foreground">
                                    {subtitle}
                                </p>
                            </div>

                            {children}
                        </motion.div>
                    </div>

                    {/* Footer link */}
                    <div className="relative z-10 px-5 pb-6 text-center text-sm text-muted-foreground sm:px-8">
                        {footer}
                    </div>
                </div>
            </div>
        </div>
    );
}
