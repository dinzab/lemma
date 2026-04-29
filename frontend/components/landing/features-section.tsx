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
  ArrowDownUp,
  CircleCheck,
  ChartBar,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WorkflowAnimation,
  type WorkflowSpec,
} from "./workflow-animation";

type Tab = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  spec: WorkflowSpec;
};

const TABS: Tab[] = [
  {
    id: "concept-explainer",
    label: "Concept Explainer",
    icon: Compass,
    spec: {
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
      actions: [
        {
          icon: Sparkles,
          title: "Adaptive Reasoning",
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
      ],
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
  {
    id: "past-exam",
    label: "Past Exam Practice",
    icon: ClipboardList,
    spec: {
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
          icon: ArrowDownUp,
          title: "Scoring & Feedback",
          desc: "Compares your answer with the official mark scheme and gives targeted hints.",
          color: "amber",
          time: "2.1 sec",
          subtasks: [
            { icon: CircleCheck, text: "Match against rubric", color: "green" },
            { icon: CircleCheck, text: "Detect missing steps", color: "green" },
            { icon: CircleCheck, text: "Build improvement plan", color: "green" },
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
  {
    id: "smart-summaries",
    label: "Smart Summaries",
    icon: FileText,
    spec: {
      input: {
        icon: BookOpen,
        title: "Pick a chapter",
        desc: "Choose any chapter from your curriculum or paste your own notes.",
        color: "sky",
        time: "0.0 sec",
        subtasks: [
          { icon: FileText, text: "Philosophy — Ch. 4", color: "blue" },
          { icon: BookOpen, text: "Class notes attached", color: "amber" },
        ],
      },
      actions: [
        {
          icon: Sparkles,
          title: "Distilling key ideas",
          desc: "Definitions, formulas, and quotes are pulled out and organised.",
          color: "amber",
          time: "1.8 sec",
          subtasks: [
            { icon: CircleCheck, text: "Highlight essentials", color: "green" },
            { icon: CircleCheck, text: "Build revision card", color: "green" },
          ],
          model: "GPT-4 · BacPrep",
        },
      ],
      output: {
        icon: FileText,
        title: "Revision card",
        desc: "Printable summary card focused on the highest-impact points.",
        color: "green",
        time: "0.4 sec",
        footer: { icon: CircleCheck, text: "Card saved to library", color: "green" },
      },
    },
  },
  {
    id: "study-plan",
    label: "Study Plan",
    icon: Pencil,
    spec: {
      input: {
        icon: Calendar,
        title: "Your goals",
        desc: "Tell us your target grade, exam date, and weekly study budget.",
        color: "sky",
        time: "0.0 sec",
        subtasks: [
          { icon: Target, text: "Target: 16 / 20", color: "blue" },
          { icon: Calendar, text: "Bac in 12 weeks", color: "amber" },
        ],
      },
      actions: [
        {
          icon: Sparkles,
          title: "Prioritising weak areas",
          desc: "We weigh your recent scores against the official syllabus.",
          color: "amber",
          time: "2.4 sec",
          subtasks: [
            { icon: CircleCheck, text: "Read past results", color: "green" },
            { icon: CircleCheck, text: "Pick high-impact topics", color: "green" },
            { icon: CircleCheck, text: "Schedule daily sessions", color: "green" },
          ],
          model: "GPT-4 · BacPrep",
        },
      ],
      output: {
        icon: ClipboardList,
        title: "Today's plan",
        desc: "Three focused sessions, with exercises and a short check-in.",
        color: "green",
        time: "0.5 sec",
        footer: { icon: Calendar, text: "Added to your calendar", color: "green" },
      },
    },
  },
  {
    id: "multilingual",
    label: "Multilingual Q&A",
    icon: Languages,
    spec: {
      input: {
        icon: Languages,
        title: "Ask in any language",
        desc: "Mix Arabic, French, and English freely — vocabulary stays consistent.",
        color: "sky",
        time: "0.0 sec",
        subtasks: [
          { icon: Languages, text: "AR · FR · EN", color: "blue" },
        ],
      },
      actions: [
        {
          icon: Search,
          title: "Curriculum-aware reasoning",
          desc: "Curriculum terms map to the official Tunisian programme.",
          color: "amber",
          time: "1.6 sec",
          subtasks: [
            { icon: CircleCheck, text: "Detect language mix", color: "green" },
            { icon: CircleCheck, text: "Match syllabus terms", color: "green" },
            { icon: CircleCheck, text: "Format answer", color: "green" },
          ],
          model: "GPT-4 · BacPrep",
        },
      ],
      output: {
        icon: CheckCircle2,
        title: "Answer in your language",
        desc: "A clear answer in the same language you asked, with curriculum terms.",
        color: "green",
        time: "0.4 sec",
        footer: { icon: BookOpen, text: "Glossary linked", color: "green" },
      },
    },
  },
  {
    id: "progress",
    label: "Progress Tracker",
    icon: LineChart,
    spec: {
      input: {
        icon: ClipboardList,
        title: "Quiz attempt",
        desc: "Each quiz, exercise, and chat answer feeds your progress profile.",
        color: "sky",
        time: "0.0 sec",
        subtasks: [
          { icon: ClipboardList, text: "Weekly mock test", color: "blue" },
          { icon: FileText, text: "Chat history", color: "amber" },
        ],
      },
      actions: [
        {
          icon: ChartBar,
          title: "Performance analysis",
          desc: "Strengths, gaps, and a confidence score per chapter, refreshed live.",
          color: "amber",
          time: "1.2 sec",
          subtasks: [
            { icon: CircleCheck, text: "Compute scores", color: "green" },
            { icon: CircleCheck, text: "Detect knowledge gaps", color: "green" },
            { icon: CircleCheck, text: "Pick next steps", color: "green" },
          ],
          model: "GPT-4 · BacPrep",
        },
      ],
      output: {
        icon: LineChart,
        title: "Recommendations",
        desc: "The three highest-impact things to study before your next session.",
        color: "green",
        time: "0.4 sec",
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
      <div className="h-px w-full bg-border" />
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
            <TabsList className="w-full justify-start overflow-x-auto rounded-none bg-transparent p-0">
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
