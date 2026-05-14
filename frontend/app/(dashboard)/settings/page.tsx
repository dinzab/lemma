"use client";

import Link from "next/link";
import { ChevronRight, Gauge } from "lucide-react";

/**
 * Settings landing page.
 *
 * Acts as a thin index into the per-category sub-routes (the only
 * one live today is `/settings/usage`). New categories — Account,
 * Preferences, Billing, Notifications — slot in as additional
 * entries in `CATEGORIES`. Each entry is rendered as a card-style
 * row so the page reads as a familiar settings menu on both
 * desktop and mobile.
 */
interface SettingsCategory {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CATEGORIES: SettingsCategory[] = [
  {
    href: "/settings/usage",
    title: "Usage & Limits",
    description:
      "View your plan, weekly quota and short-window cap. Manage per-message limits.",
    icon: Gauge,
  },
];

export default function SettingsPage() {
  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        Settings
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your plan, usage and preferences.
      </p>

      <ul className="mt-6 space-y-2 sm:mt-8">
        {CATEGORIES.map((category) => (
          <li key={category.href}>
            <CategoryRow category={category} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CategoryRow({ category }: { category: SettingsCategory }) {
  const Icon = category.icon;
  return (
    <Link
      href={category.href}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:bg-muted/40 sm:px-5 sm:py-4"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-foreground/80 transition-colors group-hover:bg-muted">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{category.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {category.description}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
