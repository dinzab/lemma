"use client";

import * as React from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Use cases", href: "#use-cases" },
      { label: "Testimonials", href: "#testimonials" },
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Subjects",
    links: [
      { label: "Mathematics", href: "#features" },
      { label: "Physics", href: "#features" },
      { label: "Philosophy", href: "#features" },
      { label: "Arabic", href: "#features" },
      { label: "French", href: "#features" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Login", href: "/login" },
      { label: "Sign up", href: "/signup" },
      { label: "Help Center", href: "#faq" },
      { label: "Support", href: "#faq" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Blog", href: "#" },
      { label: "Contact", href: "#" },
      { label: "Press", href: "#" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Service", href: "#" },
      { label: "Privacy Policy", href: "#" },
      { label: "Cookie Policy", href: "#" },
      { label: "Security", href: "#" },
    ],
  },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8 border-x px-4 py-8 sm:px-6 sm:py-16 md:py-24 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-5 xl:gap-24">
          <div className="col-span-1 space-y-2 lg:col-span-3">
            <h6 className="text-2xl font-semibold">Subscribe to our newsletter</h6>
            <p className="text-muted-foreground">
              Stay in the loop with the latest curriculum tips, study guides, and feature
              updates from BacPrep AI.
              <br className="hidden lg:block" /> One email a week — no spam, just helpful study
              insights.
            </p>
          </div>
          <div className="col-span-1 lg:col-span-2">
            <form
              className="flex justify-start gap-3 lg:justify-end"
              onSubmit={(e) => e.preventDefault()}
            >
              <input
                className="flex h-10 w-full max-w-[280px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Your email"
                type="email"
              />
              <Button size="lg" className="rounded-lg" type="submit">
                Subscribe
              </Button>
            </form>
          </div>
        </div>

        <div className="grid grid-flow-row grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-5">
          {COLUMNS.map((col) => (
            <div key={col.title} className="flex flex-col gap-5">
              <div className="text-lg font-medium">{col.title}</div>
              <ul className="space-y-3 text-muted-foreground">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("#") ? (
                      <a
                        href={link.href}
                        className="text-muted-foreground transition-colors duration-300 hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-muted-foreground transition-colors duration-300 hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-7xl border-x">
        <div className="h-px w-full bg-border" />
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 p-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary p-1.5">
              <GraduationCap className="size-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-semibold">BacPrep AI</span>
          </div>
          <p className="text-sm font-light text-muted-foreground">
            © {year} BacPrep AI. Built with care for Tunisian students.
          </p>
        </div>
      </div>
    </footer>
  );
}
