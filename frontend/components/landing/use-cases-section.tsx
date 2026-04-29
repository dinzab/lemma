"use client";

import * as React from "react";
import { motion } from "motion/react";
import {
  Calculator,
  Atom,
  ScrollText,
  ArrowRight,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

type Section = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  heading: string;
  description: string;
  quote: string;
  bg: string;
};

const SECTIONS: Section[] = [
  {
    id: "sciences",
    label: "Sciences",
    icon: Atom,
    heading:
      "Sciences students master complex physics and biology with patient explanations",
    description:
      "Get step-by-step working for kinematics, organic chemistry, and biology — all in the format Tunisian teachers expect, with worked examples drawn straight from past Bac papers.",
    quote:
      "I finally understand mechanics. The tutor walks me through every step the way my teacher does in class.",
    bg: "from-primary/15 via-secondary/15 to-accent",
  },
  {
    id: "maths",
    label: "Maths & Économie",
    icon: Calculator,
    heading:
      "Maths and Économie students build speed and confidence on the questions that matter",
    description:
      "Drill through past Bac problems with instant grading, structured working, and targeted exercises that close your weakest gaps before exam day.",
    quote:
      "My average jumped from 11 to 16 in three months. The exam-style scoring is exactly like my teachers grade.",
    bg: "from-secondary/20 via-accent to-primary/15",
  },
  {
    id: "lettres",
    label: "Lettres",
    icon: ScrollText,
    heading:
      "Lettres students write stronger essays in Arabic, French, and Philosophy",
    description:
      "Plan, structure, and refine your dissertations with feedback in Arabic and French. The tutor coaches you on argument flow, transitions, and the right vocabulary for each subject.",
    quote:
      "The summaries before my Philosophy exam were a lifesaver. They organised everything I needed to remember.",
    bg: "from-accent via-primary/15 to-secondary/15",
  },
];

export function UseCasesSection() {
  return (
    <section id="use-cases">
      <div className="h-px w-full bg-border" />
      <div className="relative z-10 overflow-hidden pt-8 pb-5 text-center">
        <div className="space-y-4">
          <h2 className="text-xl font-medium uppercase tracking-wider">Use cases</h2>
          <p className="text-base text-muted-foreground">
            Practical ways the AI tutor helps every Tunisian Bac section.
          </p>
        </div>
      </div>
      <div className="h-px w-full bg-border" />

      <div className="px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl border-x">
          <Tabs defaultValue={SECTIONS[0].id} className="w-full">
            <div className="grid lg:grid-cols-3">
              <div className="flex flex-col justify-between lg:col-span-2">
                <h2 className="px-4 py-9 text-3xl font-medium sm:px-6 md:text-4xl lg:px-8 lg:text-5xl">
                  See how we drive{" "}
                  <span className="text-muted-foreground">success</span> for{" "}
                  <span className="text-muted-foreground">every</span> section.
                </h2>
                <div className="h-px w-full bg-border" />

                {SECTIONS.map((section) => (
                  <TabsContent
                    key={section.id}
                    value={section.id}
                    className="mt-0 px-4 pt-8 pb-8 sm:px-6 lg:px-8"
                  >
                    <motion.div
                      initial={{ opacity: 0, filter: "blur(10px)" }}
                      animate={{ opacity: 1, filter: "blur(0px)" }}
                      className="space-y-4"
                    >
                      <h3 className="text-2xl font-medium md:text-3xl">
                        {section.heading}
                      </h3>
                      <p className="text-lg text-muted-foreground">{section.description}</p>
                      <Button variant="link" className="group h-auto p-0 text-primary">
                        Learn more
                        <ArrowRight className="ml-1 size-4 transition-transform group-hover:translate-x-1" />
                      </Button>
                    </motion.div>
                  </TabsContent>
                ))}

                <div className="h-px w-full bg-border" />
                <TabsList className="h-auto w-full justify-start rounded-none border-t-0 bg-transparent p-0">
                  {SECTIONS.map((section) => {
                    const Icon = section.icon;
                    return (
                      <TabsTrigger
                        key={section.id}
                        value={section.id}
                        className="flex h-18 flex-1 gap-3 rounded-none border-r px-3 last:border-r-0 data-[state=active]:bg-muted data-[state=active]:text-primary"
                      >
                        <Icon className="size-5" />
                        <span className="text-base font-normal lg:text-xl">
                          {section.label}
                        </span>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </div>

              <div className="relative h-140 w-full overflow-hidden border-l max-lg:hidden">
                {SECTIONS.map((section) => (
                  <TabsContent
                    key={section.id}
                    value={section.id}
                    className="absolute inset-0 mt-0"
                  >
                    <motion.div
                      initial={{ opacity: 0, scale: 1.02 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.5 }}
                      className={`relative h-full w-full bg-gradient-to-br ${section.bg}`}
                    >
                      <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px] opacity-40" />
                      <div className="absolute right-8 bottom-1/2 left-8 flex translate-y-1/2 items-center justify-center">
                        <section.icon className="size-40 text-foreground/15" />
                      </div>
                      <div className="absolute inset-x-6 bottom-6">
                        <div className="rounded-md border bg-card p-5 shadow-md">
                          <span className="line-clamp-3 text-xl font-medium italic">
                            “{section.quote}”
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  </TabsContent>
                ))}
              </div>
            </div>
          </Tabs>
        </div>
      </div>
    </section>
  );
}
