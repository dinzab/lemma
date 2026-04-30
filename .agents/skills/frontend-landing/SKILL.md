# BacPrep AI — Frontend & Landing Page

Reference knowledge for working in `frontend/`, especially the marketing landing page at `app/page.tsx`.

## Dev server

```bash
cd frontend
npm install --legacy-peer-deps     # @ai-sdk/react peer-dep fights with React 19, the flag is required
npm run dev                         # Next.js dev server on http://localhost:3000
```

The lockfile is committed and should be honoured. If `npm install` complains about peer deps without the flag, do not bypass with `--force`; use `--legacy-peer-deps` as above.

## Required env for the dev server to boot

`frontend/utils/supabase/middleware.ts` calls `createServerClient(...)` for every incoming request and reads `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` at module init. Empty values cause an HTTP 500 even on the public landing page (`/`).

For landing-page testing only, placeholder values are sufficient because middleware lets `/`, `/login`, `/signup`, `/api/auth`, and `/api/health` through without a network call:

```bash
# frontend/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.placeholder
```

For anything that hits Supabase (auth, dashboard, threads), use real credentials. Do not commit `.env.local`.

## Lint, typecheck, build

- Type-check: `cd frontend && npx tsc --noEmit` — must be clean before pushing.
- Lint: `cd frontend && npx eslint <files>` — the repo has ~30 pre-existing ESLint errors elsewhere, so prefer linting the files you touched rather than the whole repo unless asked.
- Build: `cd frontend && npm run build` — slow, only run before release / when CI is needed.

The Next dev server hot-reloads on file changes — no need to restart on most edits. If a stale `.next/dev/lock` is preventing startup, kill the old `next-server` PID and remove the lock.

## Landing page component map

`app/page.tsx` composes:

- `components/landing/site-header.tsx` — sticky nav + theme toggle
- `components/landing/hero-section.tsx` — hero badge + CTA
- `components/landing/features-section.tsx` — auto-rotating tabs + per-tab `WorkflowAnimation`
- `components/landing/how-it-works.tsx` — 3-step rotating panel
- `components/landing/use-cases-section.tsx`
- `components/landing/testimonials-section.tsx`
- `components/landing/pricing-section.tsx` — monthly/yearly toggle
- `components/landing/faq-section.tsx`
- `components/landing/site-footer.tsx`
- `components/landing/workflow-animation.tsx` — the animated card system used by Features
- `components/landing/border-beam.tsx` — animated gradient border (used by hero badge)
- `components/landing/reveal-on-scroll.tsx` — IntersectionObserver-based section reveal

Global CSS utilities for the landing page live in `app/globals.css`:

- `@keyframes border-beam` — used by `BorderBeam`
- `@keyframes marquee-horizontal` — used by the testimonials marquee
- `.no-scrollbar` — hide native scrollbars on horizontal containers (Tabs lists, etc.)
- `.link-animated` — underline-on-hover sweep used in the footer

## Auto-rotating tabs / steps — important pattern

`FeaturesSection` and `HowItWorks` rotate through a list every N seconds. The interval MUST be re-armed when the active item changes, otherwise a manual click leaves the progress bar de-synced from the timer. Keep the dependency on the active state:

```tsx
React.useEffect(() => {
  const id = setInterval(() => {
    const idx = TABS.findIndex((t) => t.id === activeTab);
    setActiveTab(TABS[(idx + 1) % TABS.length].id);
  }, ROTATION_MS);
  return () => clearInterval(id);
}, [activeTab]);
```

## WorkflowAnimation — adding or changing a tab

`workflow-animation.tsx` exports a `WorkflowSpec` discriminated union. Each `kind` picks a different layout component:

| `kind`           | Cards                                                | Use when…                                            |
| ---------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `three-corner`   | input top-left, action bottom-center, output top-right | The flagship single-action workflow.                 |
| `split-action`   | input top, two parallel actions, merged output bottom  | Two analyses run in parallel and combine.            |
| `fan-in`         | N source cards on the left, one output on the right    | Multiple sources merge into a single artefact.       |
| `linear`         | input left, output right                               | Direct transform; either side can carry a rich body. |

`WorkflowCardData` accepts an optional `body: ReactNode` for embedded visuals (e.g. mini calendar grid in Study Plan, mini bar chart in Progress Tracker) and `width: "sm" | "md" | "lg"` for tighter compositions.

### Animation timing

Keep the sequential reveal (card → path draws → next card → path draws). The reference pacing on the three-corner layout is:

- input card: `delay 0`
- path1 (input → action): start marker `0.5`, dashed line draws `0.8 → 1.8`, chevron `1.6`
- action card: `delay 1.5`
- path2 (action → output): start marker `2.0`, dashed line draws `2.3 → 3.3`, chevron `3.1`
- output card: `delay 3.0`
- moving dot: starts after the line is drawn (`delay + 1.4`) so it doesn't fight the draw-in.

Paths are step-shaped with a quadratic corner: `M sx sy L sx (ey ± r) Q sx ey (sx ± r) ey L ex ey`. Avoid C-bezier shortcuts — they look wobbly at the angles the cards sit at.

## Layout sizing without breaking lint

Layouts measure card positions to draw SVG paths between them. Reading `ref.current` during render trips the `react-hooks/refs` lint rule. The pattern in this codebase:

1. `useLayoutTick(containerRef)` — bumps a `tick` counter on mount, after a `100ms` settle, on `ResizeObserver` callbacks, and on window resize.
2. Each layout has a `useEffect([tick])` that reads its refs (which are stable across renders) via `getBoundingClientRect`, computes coords relative to the container, and `setState`s only when values actually change.

This avoids both the lint rule and the infinite-rerender loop that happens if you pass a fresh `refs` object literal as a `useEffect` / `useCallback` dependency.

## Mobile fallback

Every layout in `WorkflowAnimation` includes a `md:hidden` block that stacks the cards vertically with no SVG paths. When adding a new layout, add the same fallback.

## Testing the landing page

- Browse `http://localhost:3000` for the marketing page.
- DevTools → toggle device toolbar → 375px width to verify the mobile fallback.
- Theme toggle is in the header; verify both light and dark modes — workflow card colours come from theme tokens (`bg-card`, `text-card-foreground`, `border`) and the path stroke uses `text-primary/40`.
- Clicking a Features tab manually should reset the progress bar at the bottom of that tab.

## PR workflow

The repo has no CI configured at the moment (no GitHub Actions, no required checks). Always run the typecheck and the file-scoped lint locally before pushing — there is no automated safety net.
