"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Pencil,
  BookOpen,
  Sparkles,
  Brain,
  Languages,
  GraduationCap,
  ClipboardList,
  CheckCircle2,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Step = {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
};

const STEPS: Step[] = [
  {
    title: "Tell the tutor what you need",
    icon: Pencil,
    description:
      "Share your subject, level, and what you want to study — the tutor adapts to your goals from the very first message.",
  },
  {
    title: "Connect your curriculum",
    icon: BookOpen,
    description:
      "The tutor follows the official Tunisian Baccalaureate programme. Bring your notes, past exams, or photos of your textbook.",
  },
  {
    title: "Review, practice, master",
    icon: GraduationCap,
    description:
      "Every session is transparent. Review explanations, practice past exam questions, and track your improvement week by week.",
  },
];

const STEP_DURATION = 6000;

export function HowItWorks() {
  const [activeStep, setActiveStep] = React.useState(0);

  React.useEffect(() => {
    const id = setInterval(() => {
      setActiveStep((activeStep + 1) % STEPS.length);
    }, STEP_DURATION);
    return () => clearInterval(id);
  }, [activeStep]);

  return (
    <section id="how-it-works" className="flex flex-col">
      <div className="h-px w-full bg-border" />
      <div className="relative z-10 overflow-hidden pt-8 pb-5 text-center">
        <div className="space-y-4">
          <h2 className="text-xl font-medium uppercase tracking-wider">How it works</h2>
          <p className="text-base text-muted-foreground">
            A quick look at how the tutor effectively helps you study.
          </p>
        </div>
      </div>
      <div className="h-px w-full bg-border" />

      <div className="px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl border-x">
          <div className="grid max-lg:divide-y max-lg:divide-y-reverse lg:grid-cols-2 lg:divide-x">
            <div className="grid h-full grid-rows-3 divide-y max-lg:order-2">
              {STEPS.map((step, index) => {
                const Icon = step.icon;
                const isActive = activeStep === index;
                return (
                  <button
                    key={index}
                    onClick={() => setActiveStep(index)}
                    className={cn(
                      "relative flex cursor-pointer flex-col gap-5 px-4 py-9 text-left outline-none transition-colors duration-300 focus-visible:z-10 focus-visible:ring-3 sm:px-6 lg:px-8",
                      isActive ? "bg-muted/50" : "hover:bg-muted/30",
                    )}
                  >
                    <div className="flex items-center gap-5">
                      <span
                        className={cn(
                          "size-5",
                          isActive ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <Icon className="size-full" />
                      </span>
                      <h3
                        className={cn(
                          "text-xl font-medium",
                          isActive ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {step.title}
                      </h3>
                    </div>
                    <p className="text-muted-foreground">{step.description}</p>
                    {isActive && (
                      <motion.div
                        key={`progress-${index}`}
                        className="absolute inset-x-0 bottom-0 left-0 h-0.5 bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: "100%" }}
                        transition={{ duration: STEP_DURATION / 1000, ease: "linear" }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="relative flex min-h-[450px] items-center justify-center overflow-hidden bg-background/40 px-4 py-12 max-lg:h-120">
              <AnimatePresence mode="wait">
                {activeStep === 0 && <StepOne key="step-0" />}
                {activeStep === 1 && <StepTwo key="step-1" />}
                {activeStep === 2 && <StepThree key="step-2" />}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 1.05, filter: "blur(4px)" }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="relative w-full max-w-sm rounded-xl border bg-card text-card-foreground shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
    >
      {children}
    </motion.div>
  );
}

function StepOne() {
  return (
    <CardShell>
      <div className="flex items-center justify-between bg-accent/40 px-4 py-2 text-sm font-medium text-accent-foreground">
        Connecting your curriculum
        <Loader2 className="size-4 animate-spin" />
      </div>
      <div className="space-y-3 p-5 text-sm">
        <p className="font-medium">Build my Bac plan for next month.</p>
        <div className="space-y-2 text-muted-foreground">
          {[
            { icon: BookOpen, text: "1. Reading curriculum chapters" },
            { icon: ClipboardList, text: "2. Loading past exam library" },
            { icon: Sparkles, text: "3. Matching to your goal grade" },
            { icon: CheckCircle2, text: "4. Plan ready" },
          ].map((row, i) => {
            const Icon = row.icon;
            return (
              <div key={i} className="flex items-center gap-3">
                <Icon className="size-4 text-primary" />
                <span>{row.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </CardShell>
  );
}

function StepTwo() {
  const tools = [
    { icon: Brain, label: "Curriculum" },
    { icon: BookOpen, label: "Textbook" },
    { icon: Languages, label: "AR · FR · EN" },
    { icon: ClipboardList, label: "Past Bac" },
  ];
  return (
    <CardShell>
      <div className="flex h-[380px] flex-col items-center justify-center gap-8 p-8">
        <div className="relative aspect-square w-full max-w-[280px]">
          <div className="absolute inset-0 rounded-full border border-dashed border-primary/30 animate-[spin_20s_linear_infinite]" />
          <div className="absolute inset-6 rounded-full border border-primary/20 animate-[spin_15s_linear_infinite_reverse]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="z-10 flex size-20 items-center justify-center rounded-2xl border-4 border-card bg-primary shadow-lg shadow-primary/20">
              <GraduationCap className="size-10 text-primary-foreground" />
            </div>
          </div>
          {tools.map((tool, i) => {
            const Icon = tool.icon;
            const angle = (i / tools.length) * Math.PI * 2 - Math.PI / 2;
            const radius = 120;
            const x = Math.cos(angle) * radius + 140 - 28;
            const y = Math.sin(angle) * radius + 140 - 28;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15 * i, type: "spring" }}
                className="absolute flex size-14 items-center justify-center rounded-2xl border bg-card shadow-md"
                style={{ left: x, top: y }}
                title={tool.label}
              >
                <Icon className="size-6 text-primary" />
              </motion.div>
            );
          })}
        </div>
        <p className="text-center text-sm font-medium text-muted-foreground">
          Curriculum, textbook, and past exams — all linked to your tutor.
        </p>
      </div>
    </CardShell>
  );
}

function StepThree() {
  const messages = [
    { role: "user", text: "Can you check my answer to question 3?" },
    {
      role: "assistant",
      text: "Almost there — your reasoning is right, but step 2 misses a sign change. Here's the fix and a similar question to practice.",
    },
    { role: "user", text: "Got it, thanks! Let's do another." },
  ];

  return (
    <CardShell>
      <div className="flex items-center gap-2 border-b px-4 py-2 text-sm font-medium">
        <MessageSquare className="size-4 text-primary" />
        Live tutoring chat
      </div>
      <div className="space-y-3 p-5">
        {messages.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.25 }}
            className={cn(
              "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
              m.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
            )}
          >
            {m.text}
          </motion.div>
        ))}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="flex items-center gap-2 pt-2 text-xs text-muted-foreground"
        >
          <CheckCircle2 className="size-4 text-primary" /> Saved to revision tracker
        </motion.div>
      </div>
    </CardShell>
  );
}
