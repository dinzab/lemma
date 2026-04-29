"use client";

import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const SCHOOL_LOGOS = [
  "Lycée Pilote Tunis",
  "Lycée Bourguiba",
  "Lycée Ibn Charaf",
  "Lycée Sadiki",
  "Lycée El Menzah",
  "Lycée Khaznadar",
];

export function TestimonialsSection() {
  return (
    <section id="testimonials">
      <div className="h-px w-full bg-border" />
      <div className="relative z-10 overflow-hidden pt-8 pb-5 text-center">
        <div className="space-y-4">
          <h2 className="text-xl font-medium uppercase tracking-wider">Testimonials</h2>
          <p className="text-base text-muted-foreground">
            Real stories from Tunisian students who improved their grades with the AI tutor.
          </p>
        </div>
      </div>
      <div className="h-px w-full bg-border" />

      <div className="px-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center overflow-hidden border-x">
          <div className="flex w-full max-w-[830px] flex-col items-center gap-8 px-4 py-8 md:px-6 md:py-16 lg:px-8 lg:py-24">
            <h3 className="text-center text-xl font-medium md:text-3xl">
              “BacPrep AI completely transformed how I prepare for exams. What used to take
              hours of searching through notes now happens in minutes — and I have never
              felt more confident going into my Bac.”
            </h3>
            <div className="flex items-center gap-2">
              <Avatar className="size-10">
                <AvatarImage
                  src="https://api.dicebear.com/7.x/notionists/svg?seed=amira&backgroundColor=fbe7d7"
                  alt="Amira B."
                />
                <AvatarFallback>AB</AvatarFallback>
              </Avatar>
              <span className="text-muted-foreground">Amira B., Sciences Section, Tunis</span>
            </div>
          </div>

          <div className="w-full border-t">
            <div className="no-scrollbar flex overflow-x-auto">
              {SCHOOL_LOGOS.map((school) => (
                <div
                  key={school}
                  className="flex min-w-[180px] flex-1 cursor-default items-center justify-center border-r px-4 py-8 text-center text-sm font-medium tracking-wide text-muted-foreground transition-all last:border-r-0 hover:text-foreground"
                >
                  {school}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
