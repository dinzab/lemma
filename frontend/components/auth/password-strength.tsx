"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const RULES = [
    { label: "8+ characters", test: (v: string) => v.length >= 8 },
    { label: "Uppercase", test: (v: string) => /[A-Z]/.test(v) },
    { label: "Lowercase", test: (v: string) => /[a-z]/.test(v) },
    { label: "Number", test: (v: string) => /[0-9]/.test(v) },
    { label: "Symbol", test: (v: string) => /[^A-Za-z0-9]/.test(v) },
] as const;

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;
const STRENGTH_BAR_COLORS = [
    "bg-destructive",
    "bg-destructive",
    "bg-secondary",
    "bg-secondary",
    "bg-primary",
];

/**
 * Visual password strength meter for the signup form. Counts how many
 * of the 5 zod rules the current value satisfies and renders a 5-segment
 * bar plus a checklist. Decorative — actual validation happens in zod.
 */
export function PasswordStrength({ value }: { value: string }) {
    const passed = RULES.filter((r) => r.test(value)).length;
    const score = value.length === 0 ? 0 : passed;

    if (value.length === 0) {
        return null;
    }

    const labelIdx = Math.max(0, Math.min(4, score - 1));
    const label = STRENGTH_LABELS[labelIdx];

    return (
        <div className="mt-2 space-y-2">
            <div
                role="meter"
                aria-valuemin={0}
                aria-valuemax={5}
                aria-valuenow={score}
                aria-label={`Password strength: ${label}`}
                className="flex gap-1"
            >
                {Array.from({ length: 5 }).map((_, i) => (
                    <span
                        key={i}
                        className={cn(
                            "h-1.5 flex-1 rounded-full transition-colors",
                            i < score
                                ? STRENGTH_BAR_COLORS[score - 1]
                                : "bg-border",
                        )}
                    />
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{label}</span>
                {RULES.map((r) => {
                    const ok = r.test(value);
                    return (
                        <span
                            key={r.label}
                            className={cn(
                                "transition-colors",
                                ok && "text-primary",
                            )}
                        >
                            {ok ? "✓" : "○"} {r.label}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}
