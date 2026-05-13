-- =============================================================================
-- Usage Events + Plans Migration for BacPrep AI
-- =============================================================================
-- Run this SQL in your Supabase Dashboard SQL Editor
-- Dashboard: https://supabase.com/dashboard/project/{your-project-ref}/sql
--
-- Adds:
--   - public.plans           (plan definitions with token limits)
--   - public.user_plans      (which plan each user is on)
--   - public.usage_events    (per-run token consumption log)
--
-- Rationale: Lemma needs usage-based rate limiting so free-tier students
-- cannot exceed their token allowance. Two buckets enforce the limits:
--   1. Rolling 7-day window  (e.g. 100 000 tokens / week)
--   2. Rolling 5-hour window (e.g.  20 000 tokens / 5 h)
-- A chat request is blocked (HTTP 429) when either bucket is exhausted.
-- The backend sums usage_events over the relevant windows at request time.
-- =============================================================================

-- ── plans ───────────────────────────────────────────────────────────────────
-- Static plan definitions. Seeded with the free plan; paid tiers added later.
CREATE TABLE IF NOT EXISTS public.plans (
    id TEXT PRIMARY KEY,                     -- e.g. 'free', 'pro', 'unlimited'
    label TEXT NOT NULL,                     -- Human-readable name
    weekly_token_limit INT NOT NULL,         -- Max tokens in a rolling 7-day window
    window_token_limit INT NOT NULL,         -- Max tokens in a rolling N-hour window
    window_hours INT NOT NULL DEFAULT 5,     -- Length of the short rolling window (hours)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the free plan
INSERT INTO public.plans (id, label, weekly_token_limit, window_token_limit, window_hours)
VALUES ('free', 'Free', 100000, 20000, 5)
ON CONFLICT (id) DO NOTHING;

-- ── user_plans ──────────────────────────────────────────────────────────────
-- Maps each user to their active plan. Defaults to 'free' on first insert.
CREATE TABLE IF NOT EXISTS public.user_plans (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES public.plans(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own plan"
ON public.user_plans FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Mutations go through the service-role key only (same pattern as agent_runs).

-- ── usage_events ────────────────────────────────────────────────────────────
-- One row per completed agent run, recording the total tokens consumed.
CREATE TABLE IF NOT EXISTS public.usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
    thread_id UUID REFERENCES public.threads(id) ON DELETE SET NULL,
    tokens_used INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_created
    ON public.usage_events(user_id, created_at DESC);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own usage events"
ON public.usage_events FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Mutations go through the service-role key only.

-- =============================================================================
-- Verification queries
-- =============================================================================
-- SELECT * FROM public.plans;
-- SELECT * FROM public.user_plans LIMIT 5;
-- SELECT * FROM public.usage_events LIMIT 5;
-- SELECT * FROM pg_policies WHERE tablename IN ('plans', 'user_plans', 'usage_events');
