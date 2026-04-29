"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Plan = {
  name: string;
  description: string;
  monthly: number;
  yearly: number;
  popular?: boolean;
  features: string[];
};

const PLANS: Plan[] = [
  {
    name: "Starter",
    description: "For students getting started with the AI tutor.",
    monthly: 0,
    yearly: 0,
    features: [
      "Daily concept explanations",
      "Limited past Bac questions",
      "Smart summaries (3 / week)",
      "Arabic, French & English chat",
      "Community support",
      "1 student profile",
    ],
  },
  {
    name: "Bac Plus",
    description: "For students preparing seriously for the Baccalaureate.",
    monthly: 8,
    yearly: 5,
    popular: true,
    features: [
      "Unlimited concept explanations",
      "Full past Baccalaureate library",
      "Adaptive scoring & feedback",
      "Personalised daily study plan",
      "Priority chat support",
      "Progress tracker across subjects",
      "Live exam-week mock papers",
    ],
  },
  {
    name: "Family",
    description: "For parents supporting more than one student at home.",
    monthly: 14,
    yearly: 9,
    features: [
      "Everything in Bac Plus",
      "Up to 3 student profiles",
      "Weekly parent recap email",
      "Dedicated success advisor",
      "Shared revision library",
      "Year-round priority support",
    ],
  },
];

export function PricingSection() {
  const [isYearly, setIsYearly] = React.useState(false);

  return (
    <section id="pricing">
      <div className="h-px w-full bg-border" />
      <div className="relative z-10 overflow-hidden pt-8 pb-5 text-center">
        <div className="space-y-4">
          <h2 className="text-xl font-medium uppercase tracking-wider">Pricing</h2>
          <p className="text-base text-muted-foreground">
            Flexible plans that grow with your study goals — start free, upgrade when ready.
          </p>
        </div>
      </div>
      <div className="h-px w-full bg-border" />

      <div className="px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl border-x">
          <div className="flex flex-col items-center gap-5 px-4 py-8 text-center md:py-16 lg:py-24">
            <h3 className="text-2xl font-semibold sm:text-3xl lg:text-4xl">
              Plans that scale with your study goals
            </h3>
            <p className="max-w-2xl text-lg text-muted-foreground">
              Find the right balance of features and depth for your Bac year — designed to
              help you study smarter and grow more confident.
            </p>

            <div className="inline-flex items-center gap-1 rounded-md bg-muted p-1">
              <button
                onClick={() => setIsYearly(false)}
                className={cn(
                  "flex cursor-pointer items-center gap-1 rounded-sm px-6 py-2 text-sm transition-colors",
                  !isYearly
                    ? "bg-card text-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Monthly
              </button>
              <button
                onClick={() => setIsYearly(true)}
                className={cn(
                  "flex cursor-pointer items-center gap-1 rounded-sm px-3 py-2 text-sm transition-colors",
                  isYearly
                    ? "bg-card text-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Yearly{" "}
                <Badge variant="destructive" className="rounded-full px-2 py-0.5">
                  Save 35%
                </Badge>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 border-t md:grid-cols-3">
            {PLANS.map((plan) => {
              const price = isYearly ? plan.yearly : plan.monthly;
              return (
                <div
                  key={plan.name}
                  className={cn(
                    "flex flex-col gap-6 border-b px-8 py-8 last:border-r-0 md:border-r md:border-b-0",
                    plan.popular && "bg-muted/30",
                  )}
                >
                  <div className="space-y-4 border-b pb-6">
                    <div className="space-y-2">
                      <h4 className="text-2xl font-semibold lg:text-3xl">{plan.name}</h4>
                      <p className="text-sm text-muted-foreground">{plan.description}</p>
                    </div>
                    <div className="flex items-baseline gap-1">
                      {price === 0 ? (
                        <span className="text-5xl font-bold">Free</span>
                      ) : (
                        <>
                          <span className="text-lg font-medium text-muted-foreground">$</span>
                          <span className="text-5xl font-bold">{price}</span>
                          <span className="text-lg text-muted-foreground">/month</span>
                        </>
                      )}
                    </div>
                    <Button
                      variant={plan.popular ? "default" : "secondary"}
                      size="lg"
                      className="w-full rounded-lg"
                      asChild
                    >
                      <Link href="/signup">{price === 0 ? "Start free" : "Choose plan"}</Link>
                    </Button>
                  </div>
                  <ul className="space-y-4 pt-4">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex gap-2 py-1">
                        <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
