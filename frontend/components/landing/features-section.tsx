"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen,
  Compass,
  ClipboardList,
  FileText,
  Languages,
  LineChart,
  Pencil,
  Sparkles,
  CheckCircle2,
  Search,
  Calendar,
  Target,
  CircleCheck,
  ChartBar,
  ListChecks,
  StickyNote,
  Activity,
  TrendingUp,
  Zap,
  GraduationCap,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkflowAnimation, type WorkflowSpec } from "./workflow-animation";

type Tab = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  spec: WorkflowSpec;
};

/* --- Mini visual bodies used inside cards --- */

function MiniCalendarBody() {
  const days = Array.from({ length: 14 });
  const studyDays = [1, 2, 4, 5, 8, 9, 11, 12];
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Next 2 weeks</span>
        <span>3h/day</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((_, i) => {
          const isStudy = studyDays.includes(i);
          return (
            <motion.div
              key={i}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 1.8 + i * 0.04, duration: 0.25 }}
              className={`h-6 rounded-md ${isStudy ? "bg-primary/80" : "bg-muted"}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function MiniChartBody() {
  const bars = [
    { label: "Maths", value: 78, color: "bg-emerald-500/80" },
    { label: "Physics", value: 62, color: "bg-amber-500/80" },
    { label: "Bio", value: 84, color: "bg-emerald-500/80" },
    { label: "Philo", value: 41, color: "bg-rose-500/80" },
    { label: "Arabic", value: 70, color: "bg-emerald-500/80" },
  ];
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Confidence by subject</span>
        <span>This week</span>
      </div>
      <div className="space-y-1.5">
        {bars.map((b, i) => (
          <div key={b.label} className="flex items-center gap-2">
            <span className="w-12 text-[10px] text-muted-foreground">{b.label}</span>
            <div className="relative h-2 grow overflow-hidden rounded-full bg-muted">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${b.value}%` }}
                transition={{ delay: 1.6 + i * 0.12, duration: 0.7, ease: "easeOut" }}
                className={`absolute inset-y-0 left-0 ${b.color}`}
              />
            </div>
            <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">{b.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TABS: Tab[] = [
  /* 1. Concept Explainer — three-corner */
  {
    id: "concept-explainer",
    label: "Concept Explainer",
    icon: Compass,
    spec: {
      kind: "three-corner",
      input: {
        icon: BookOpen,
        title: "Lesson question",
        desc: "A topic from your curriculum, an exercise, or a snap of your textbook page.",
        color: "sky",
        time: "0.0 sec",
        subtasks: [
          { icon: FileText, text: "Lesson note", color: "blue" },
          { icon: BookOpen, text: "Textbook page", color: "amber" },
        ],
      },
      action: {
        icon: Sparkles,
        title: "Adaptive reasoning",
        desc: "Breaks the topic into the right level of detail with worked examples.",
        color: "amber",
        time: "1.4 sec",
        subtasks: [
          { icon: CircleCheck, text: "Curriculum-aligned terms", color: "green" },
          { icon: CircleCheck, text: "Step-by-step working", color: "green" },
          { icon: CircleCheck, text: "Quick check question", color: "green" },
        ],
        model: "GPT-4 · BacPrep",
      },
      output: {
        icon: CheckCircle2,
        title: "Clear explanation",
        desc: "Step-by-step answer with examples, saved to your notes.",
        color: "green",
        time: "0.5 sec",
        footer: { icon: FileText, text: "Saved to my notes", color: "green" },
      },
    },
  },

  /* 2. Past Exam Practice — split-action (2 parallel checks) */
  {
    id: "past-exam",
    label: "Past Exam Practice",
    icon: ClipboardList,
    spec: {
      kind: "split-action",
      input: {
        icon: ClipboardList,
        title: "Past Bac question",
        desc: "Pick a year, subject, and section to start a timed practice run.",
        color: "sky",
        time: "0.0 sec",
        subtasks: [
          { icon: FileText, text: "Bac 2023 — Maths", color: "blue" },
          { icon: BookOpen, text: "Sciences section", color: "amber" },
        ],
      },
      actions: [
        {
          icon: Target,
          title: "Match against rubric",
          desc: "Scores your answer against the official mark scheme.",
          color: "amber",
          time: "1.6 sec",
          subtasks: [
            { icon: CircleCheck, text: "Method points", color: "green" },
            { icon: CircleCheck, text: "Working out", color: "green" },
          ],
          model: "GPT-4 · BacPrep",
        },
        {
          icon: Search,
          title: "Detect missing steps",
          desc: "Finds gaps and flags concepts you should revisit.",
          color: "amber",
          time: "1.4 sec",
          subtasks: [
            { icon: CircleCheck, text: "Reasoning gaps", color: "green" },
            { icon: CircleCheck, text: "Common pitfalls", color: "green" },
          ],
          model: "GPT-4 · BacPrep",
        },
      ],
      output: {
        icon: ChartBar,
        title: "Improvement plan",
        desc: "Strengths, gaps, and the next 3 exercises to close them.",
        color: "green",
        time: "0.4 sec",
        footer: { icon: ClipboardList, text: "Plan added to your tracker", color: "green" },
      },
    },
  },

  /* 3. Smart Summaries — fan-in (multiple sources -> 1 revision card) */
  {
    id: "smart-summaries",
    label: "Smart Summaries",
    icon: FileText,
    spec: {
      kind: "fan-in",
      inputs: [
        {
          icon: BookOpen,
          title: "Textbook chapter",
          desc: "Philosophy — Ch. 4, Reason & belief.",
          color: "sky",
          typeLabel: "source",
          time: "0.0 sec",
        },
        {
          icon: StickyNote,
          title: "Class notes",
          desc: "Your handwritten notes from the last 3 lessons.",
          color: "sky",
          typeLabel: "source",
          time: "0.1 sec",
        },
        {
          icon: GraduationCap,
          title: "Past Bac questions",
          desc: "Recurring patterns from the last 5 years.",
          color: "sky",
          typeLabel: "source",
          time: "0.2 sec",
        },
      ],
      output: {
        icon: ListChecks,
        title: "Revision card",
        desc: "A focused summary built from every source — definitions, key quotes, common questions.",
        color: "green",
        time: "1.4 sec",
        subtasks: [
          { icon: CircleCheck, text: "5 essential definitions", color: "green" },
          { icon: CircleCheck, text: "3 quotes to remember", color: "green" },
          { icon: CircleCheck, text: "2 likely Bac questions", color: "green" },
        ],
        footer: { icon: CircleCheck, text: "Saved to revision deck", color: "green" },
      },
    },
  },

  /* 4. Study Plan — linear (goals -> 2-week calendar) */
  {
    id: "study-plan",
    label: "Study Plan",
    icon: Pencil,
    spec: {
      kind: "linear",
      input: {
        icon: Calendar,
        title: "Your goals",
        desc: "Tell us your target grade, exam date, and weekly study budget.",
        color: "sky",
        time: "0.0 sec",
        subtasks: [
          { icon: Target, text: "Target: 16 / 20", color: "blue" },
          { icon: Calendar, text: "Bac in 12 weeks", color: "amber" },
          { icon: Zap, text: "≈ 3h / day", color: "purple" },
        ],
      },
      output: {
        icon: ClipboardList,
        title: "Your 2-week plan",
        desc: "Sessions sized to your weak areas, scheduled around your existing classes.",
        color: "green",
        time: "1.4 sec",
        body: <MiniCalendarBody />,
        footer: { icon: Calendar, text: "Synced with your calendar", color: "green" },
      },
    },
  },

  /* 5. Multilingual Q&A — split-action (translate + answer in parallel) */
  {
    id: "multilingual",
    label: "Multilingual Q&A",
    icon: Languages,
    spec: {
      kind: "split-action",
      input: {
        icon: Languages,
        title: "Ask in any language",
        desc: "Mix Arabic, French, and English freely — the tutor keeps up.",
        color: "sky",
        time: "0.0 sec",
        subtasks: [{ icon: Languages, text: "“ما هي الدوال المثلثية؟”", color: "blue" }],
      },
      actions: [
        {
          icon: Languages,
          title: "Detect & translate",
          desc: "Detects the language mix and aligns terms across AR/FR/EN.",
          color: "amber",
          time: "0.6 sec",
          subtasks: [
            { icon: CircleCheck, text: "Language mix detected", color: "green" },
            { icon: CircleCheck, text: "Glossary linked", color: "green" },
          ],
          model: "GPT-4 · BacPrep",
        },
        {
          icon: Search,
          title: "Curriculum match",
          desc: "Maps the question to the official Tunisian Bac syllabus.",
          color: "amber",
          time: "1.0 sec",
          subtasks: [
            { icon: CircleCheck, text: "Syllabus terms matched", color: "green" },
            { icon: CircleCheck, text: "Worked example fetched", color: "green" },
          ],
          model: "GPT-4 · BacPrep",
        },
      ],
      output: {
        icon: CheckCircle2,
        title: "Answer in your language",
        desc: "A clear, curriculum-aligned answer in the language you asked.",
        color: "green",
        time: "0.5 sec",
        footer: { icon: BookOpen, text: "Glossary linked", color: "green" },
      },
    },
  },

  /* 6. Progress Tracker — linear with rich activity feed + chart bodies */
  {
    id: "progress",
    label: "Progress Tracker",
    icon: LineChart,
    spec: {
      kind: "linear",
      input: {
        icon: Activity,
        title: "Live activity",
        desc: "Every quiz, exercise, and chat answer feeds your profile.",
        color: "sky",
        typeLabel: "feed",
        time: "live",
        subtasks: [
          { icon: CircleCheck, text: "Quiz: Algebra · 18/20", color: "green" },
          { icon: CircleCheck, text: "Chat: Limits explained", color: "blue" },
          { icon: CircleCheck, text: "Exercise: Vectors · 14/20", color: "amber" },
          { icon: CircleCheck, text: "Mock: Maths Bac · 15/20", color: "green" },
        ],
      },
      output: {
        icon: TrendingUp,
        title: "Recommendations",
        desc: "Confidence per subject, with the next three things to study.",
        color: "green",
        typeLabel: "chart",
        time: "1.2 sec",
        body: <MiniChartBody />,
        footer: { icon: CircleCheck, text: "Tracker updated", color: "green" },
      },
    },
  },
];

const ROTATION_MS = 15000;

export function FeaturesSection() {
  const [activeTab, setActiveTab] = React.useState(TABS[0].id);

  React.useEffect(() => {
    const interval = setInterval(() => {
      const idx = TABS.findIndex((t) => t.id === activeTab);
      setActiveTab(TABS[(idx + 1) % TABS.length].id);
    }, ROTATION_MS);
    return () => clearInterval(interval);
  }, [activeTab]);

  const active = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  return (
    <section id="features" className="flex flex-col">
      <div className="relative z-10 overflow-hidden pt-8 pb-5 text-center">
        <div className="space-y-4">
          <h2 className="text-xl font-medium uppercase tracking-wider">Features</h2>
          <p className="text-base text-muted-foreground">
            Boost your grades with an AI tutor that eliminates confusion and streamlines exam prep.
          </p>
        </div>
      </div>
      <div className="h-px w-full bg-border" />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="border-b px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl border-x">
            <TabsList className="no-scrollbar w-full justify-start overflow-x-auto rounded-none bg-transparent p-0">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.id === activeTab;
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="relative h-15 flex-1 overflow-hidden rounded-none border-x border-t-0 border-b-0 px-4 py-3 data-[state=active]:bg-muted"
                  >
                    <Icon className="mr-2 size-4" /> {tab.label}
                    {isActive && (
                      <motion.div
                        key={`tab-progress-${tab.id}`}
                        className="absolute inset-x-0 bottom-0 left-0 h-0.5 bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: "100%" }}
                        transition={{ duration: ROTATION_MS / 1000, ease: "linear" }}
                      />
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        </div>

        <div className="px-4 sm:px-6 lg:px-8">
          <div
            className="relative mx-auto h-[460px] max-w-7xl overflow-hidden border-x bg-background/50 md:h-[600px]"
            style={{
              backgroundImage:
                "radial-gradient(circle, var(--border) 1px, transparent 1px)",
              backgroundSize: "18px 18px",
            }}
          >
            <AnimatePresence mode="wait">
              <TabsContent
                key={active.id}
                value={active.id}
                forceMount
                className="mt-0 flex h-full items-center justify-center p-4 sm:p-6 lg:p-8"
              >
                <motion.div
                  key={active.id}
                  initial={{ opacity: 0, filter: "blur(8px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, filter: "blur(8px)" }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="relative h-full w-full max-w-5xl"
                >
                  <WorkflowAnimation spec={active.spec} />
                </motion.div>
              </TabsContent>
            </AnimatePresence>
          </div>
        </div>
      </Tabs>
    </section>
  );
}
