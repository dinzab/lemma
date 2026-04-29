"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BorderBeam } from "./border-beam";

const AVATAR_SEEDS = ["amira", "youssef", "salma", "mohamed"];

export function HeroSection() {
  return (
    <section
      id="home"
      className="relative -mt-16 flex flex-col overflow-hidden pt-16"
    >
      <div className="border-b px-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 border-x px-4 py-8 sm:px-6 sm:py-16 lg:px-8 lg:py-24">
          <div className="flex flex-col items-center gap-6 text-center">
            <motion.div
              initial={{ opacity: 0, filter: "blur(10px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.5 }}
              className="space-y-4"
            >
              <Badge
                variant="outline"
                className="relative gap-2.5 rounded-full bg-muted px-1.5 py-1"
              >
                <span className="flex h-5 items-center rounded-full bg-primary px-2 py-0.5 text-primary-foreground">
                  🔥 New
                </span>
                <span className="text-sm font-normal text-muted-foreground">
                  Introducing AI Tutor
                </span>
                <BorderBeam />
              </Badge>
              <h1 className="text-3xl font-semibold leading-tight sm:text-4xl lg:text-5xl lg:leading-[1.2]">
                Study with an AI tutor
                <br className="hidden sm:block" /> that helps you ace your Bac
              </h1>
              <p className="mx-auto max-w-3xl text-lg text-muted-foreground md:text-xl">
                Get instant explanations, practice with past Baccalaureate questions, and
                receive structured summaries — all tailored to the official Tunisian
                curriculum.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, filter: "blur(10px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="flex flex-wrap items-center justify-center gap-4"
            >
              <Button size="lg" className="rounded-lg" asChild>
                <Link href="/signup">
                  <ArrowUpRight className="size-5" />
                  Get Started
                </Link>
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="rounded-lg"
                asChild
              >
                <a href="#pricing">
                  <Sparkles className="size-5" />
                  View Pricing
                </a>
              </Button>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, filter: "blur(10px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex w-full items-center justify-center gap-4 max-sm:flex-col sm:gap-7"
          >
            <div className="flex flex-1 items-center justify-end gap-3">
              <div className="flex flex-row items-center justify-center">
                {AVATAR_SEEDS.map((seed) => (
                  <div key={seed} className="relative -me-3.5 last:me-0">
                    <span className="relative flex size-10 shrink-0 overflow-hidden rounded-full ring-2 ring-background transition-all duration-300 ease-in-out hover:z-10 hover:scale-105">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={`Student ${seed}`}
                        className="aspect-square size-full"
                        src={`https://api.dicebear.com/7.x/notionists/svg?seed=${seed}&backgroundColor=fbe7d7,f5e5c7,fad6b3,fcaf41`}
                      />
                    </span>
                  </div>
                ))}
              </div>
              <div>
                <span className="text-lg font-medium">10K+</span>{" "}
                <span className="text-muted-foreground">Students</span>
              </div>
            </div>
            <div className="hidden h-4 w-px shrink-0 bg-border sm:block" />
            <div className="flex flex-1 items-center gap-3">
              <div className="flex gap-px text-primary">
                {[1, 2, 3, 4, 5].map((i) => (
                  <svg
                    key={i}
                    className={cn(
                      "size-5",
                      i === 5
                        ? "fill-muted-foreground/20 stroke-muted-foreground/30"
                        : "fill-current",
                    )}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
                  </svg>
                ))}
              </div>
              <div>
                <span className="text-lg font-medium">4.5</span>{" "}
                <span className="text-muted-foreground">Ratings</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
