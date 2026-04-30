"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Sparkles, GraduationCap, BookOpen, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BorderBeam } from "@/components/landing/border-beam";

const AVATAR_SEEDS = ["amira", "youssef", "salma", "mohamed", "leila"];

/**
 * Decorative left-side panel for the auth pages. Mirrors the landing-page
 * vibe: BorderBeam-accented preview card, subtle dot grid + gradient orbs,
 * fade-up motion, avatar pile + rating row.
 *
 * The visual content does NOT participate in the form — it's purely
 * marketing surface, hidden on small screens to keep mobile focused on
 * the form itself.
 */
export function AuthDecorativePanel({
    title,
    subtitle,
    badge,
}: {
    title: React.ReactNode;
    subtitle: string;
    badge: string;
}) {
    return (
        <div className="relative hidden h-full overflow-hidden border-r border-border bg-muted/30 lg:block">
            {/* Background — dot grid + gradient orbs */}
            <div
                aria-hidden
                className="absolute inset-0 [background-image:radial-gradient(theme(colors.border)_1px,transparent_1px)] [background-size:22px_22px] opacity-50"
            />
            <div
                aria-hidden
                className="absolute -left-32 -top-32 size-[420px] rounded-full bg-primary/25 blur-[120px]"
            />
            <div
                aria-hidden
                className="absolute -right-24 bottom-0 size-[360px] rounded-full bg-secondary/30 blur-[120px]"
            />

            <div className="relative flex h-full flex-col justify-between p-10 xl:p-14">
                {/* Top: badge + heading */}
                <motion.div
                    initial={{ opacity: 0, filter: "blur(8px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    transition={{ duration: 0.5 }}
                    className="space-y-5"
                >
                    <Badge
                        variant="outline"
                        className="relative gap-2.5 rounded-full bg-background/70 px-1.5 py-1 backdrop-blur"
                    >
                        <span className="flex h-5 items-center rounded-full bg-primary px-2 py-0.5 text-primary-foreground">
                            <Sparkles className="size-3" />
                        </span>
                        <span className="pe-1 text-sm font-normal text-muted-foreground">
                            {badge}
                        </span>
                        <BorderBeam />
                    </Badge>

                    <h2 className="text-3xl font-semibold leading-tight tracking-tight xl:text-4xl xl:leading-[1.15]">
                        {title}
                    </h2>
                    <p className="max-w-md text-base text-muted-foreground">
                        {subtitle}
                    </p>
                </motion.div>

                {/* Middle: floating preview card (mock chat) */}
                <motion.div
                    initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.6, delay: 0.25 }}
                    className="relative my-10"
                    style={{ animation: "orion-float 6s ease-in-out infinite" }}
                >
                    <div className="relative overflow-hidden rounded-2xl border border-border bg-card/90 p-5 shadow-xl backdrop-blur">
                        {/* Question bubble */}
                        <div className="mb-4 flex items-start gap-3">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                                <GraduationCap className="size-4" />
                            </div>
                            <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm text-foreground">
                                Solve <span className="font-mono">x² − 5x + 6 = 0</span>{" "}
                                step by step.
                            </div>
                        </div>

                        {/* Tutor reply card */}
                        <div className="ml-11 rounded-2xl rounded-tl-sm border border-border bg-background/70 p-4 text-sm">
                            <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                <Wand2 className="size-3.5 text-primary" />
                                AI Tutor · Reasoning
                            </div>
                            <ol className="space-y-1.5 text-foreground">
                                <li className="flex gap-2">
                                    <span className="text-muted-foreground">1.</span>
                                    <span>
                                        Factor:{" "}
                                        <span className="font-mono">
                                            (x − 2)(x − 3) = 0
                                        </span>
                                    </span>
                                </li>
                                <li className="flex gap-2">
                                    <span className="text-muted-foreground">2.</span>
                                    <span>
                                        Solutions:{" "}
                                        <span className="font-mono">x = 2</span>{" "}
                                        or{" "}
                                        <span className="font-mono">x = 3</span>
                                    </span>
                                </li>
                            </ol>

                            {/* Mini "verified" badge row */}
                            <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <BookOpen className="size-3.5" />
                                Matches Bac Maths · Section Sciences
                            </div>
                        </div>

                        <BorderBeam className="rounded-2xl" />
                    </div>
                </motion.div>

                {/* Bottom: social proof */}
                <motion.div
                    initial={{ opacity: 0, filter: "blur(8px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    transition={{ duration: 0.5, delay: 0.45 }}
                    className="flex items-center gap-4"
                >
                    <div className="flex flex-row">
                        {AVATAR_SEEDS.map((seed) => (
                            <span
                                key={seed}
                                className="relative -me-3 flex size-9 shrink-0 overflow-hidden rounded-full ring-2 ring-background last:me-0"
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    alt={`Student ${seed}`}
                                    className="aspect-square size-full"
                                    src={`https://api.dicebear.com/7.x/notionists/svg?seed=${seed}&backgroundColor=fbe7d7,f5e5c7,fad6b3,fcaf41`}
                                />
                            </span>
                        ))}
                    </div>
                    <div className="text-sm">
                        <span className="font-semibold text-foreground">10K+ students</span>{" "}
                        <span className="text-muted-foreground">
                            studying smarter every day
                        </span>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
