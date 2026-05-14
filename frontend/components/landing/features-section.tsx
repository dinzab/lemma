"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkflowAnimation } from "./workflow-animation";
import { TUTOR_CAPABILITY_TABS } from "./tutor-capability-tabs";

const TABS = TUTOR_CAPABILITY_TABS;

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
