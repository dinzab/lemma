"use client";

import * as React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

const PRODUCT_FAQS = [
  {
    q: "Is BacPrep AI aligned with the Tunisian Baccalaureate programme?",
    a: "Yes. The tutor follows the official Tunisian curriculum across all sections (Sciences, Maths, Lettres, Économie, Informatique, Techniques) and uses the same vocabulary you’ll see on the exam.",
  },
  {
    q: "Can I ask questions in Arabic and French as well?",
    a: "Absolutely. You can ask in Arabic, French, or English — and even mix them in the same conversation. Answers come back in the language you used.",
  },
  {
    q: "How is BacPrep AI different from a generic chatbot?",
    a: "It's tuned for the Tunisian Baccalaureate. The tutor uses curriculum-correct definitions, gives step-by-step working in the format your teachers expect, and tracks where you’re strong and where you need more practice.",
  },
];

const PLANS_FAQS = [
  {
    q: "Can I switch plans at any time?",
    a: "Yes. You can upgrade, downgrade, or cancel from your account in one click. Changes take effect at the start of the next billing cycle.",
  },
  {
    q: "Do you support past Baccalaureate exams?",
    a: "Yes. Bac Plus includes the full past-exam library with timed practice, instant grading, and a full explanation for every question.",
  },
];

export function FaqSection() {
  return (
    <section id="faq">
      <div className="h-px w-full bg-border" />
      <div className="relative z-10 overflow-hidden pt-8 pb-5 text-center">
        <div className="space-y-4">
          <h2 className="text-xl font-medium uppercase tracking-wider">FAQ</h2>
          <p className="text-base text-muted-foreground">
            Essential answers about studying with the AI tutor.
          </p>
        </div>
      </div>
      <div className="h-px w-full bg-border" />

      <div className="border-b px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl border-x">
          <div className="flex flex-col items-center gap-5 border-b px-4 py-8 text-center md:py-16 lg:py-24">
            <h3 className="text-2xl font-semibold sm:text-3xl lg:text-4xl">
              Need help? We&apos;ve got answers
            </h3>
            <p className="text-lg text-muted-foreground">
              Explore the most common questions about BacPrep AI and find everything you need.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              <Button size="lg" className="rounded-lg">
                Docs
              </Button>
              <Button variant="secondary" size="lg" className="rounded-lg">
                Contact us
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-0 px-4 py-4 sm:px-8 md:py-16 lg:grid-cols-2 lg:gap-9 lg:py-24">
            <div>
              <p className="pb-2.5 text-lg font-semibold text-primary lg:text-xl">
                Product &amp; Features
              </p>
              <Accordion type="single" collapsible className="w-full">
                {PRODUCT_FAQS.map((faq, index) => (
                  <AccordionItem key={index} value={`product-${index}`}>
                    <AccordionTrigger>
                      {index + 1}. {faq.q}
                    </AccordionTrigger>
                    <AccordionContent>{faq.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
            <div className="max-lg:mt-8">
              <p className="pb-2.5 text-lg font-semibold text-primary lg:text-xl">
                Plans &amp; Usage
              </p>
              <Accordion type="single" collapsible className="w-full">
                {PLANS_FAQS.map((faq, index) => (
                  <AccordionItem key={index} value={`plans-${index}`}>
                    <AccordionTrigger>
                      {index + 1}. {faq.q}
                    </AccordionTrigger>
                    <AccordionContent>{faq.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
