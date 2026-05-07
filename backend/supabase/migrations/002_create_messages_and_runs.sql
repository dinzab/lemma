-- =============================================================================
-- Messages + Agent Runs Migration for BacPrep AI
-- =============================================================================
-- Run this SQL in your Supabase Dashboard SQL Editor
-- Dashboard: https://supabase.com/dashboard/project/{your-project-ref}/sql
--
-- Adds:
--   - public.agent_runs   (tracks the lifecycle of one streaming turn)
--   - public.messages     (flat conversation log used for UI history reads)
--
-- Rationale: LangGraph checkpoints store state as opaque JSON blobs and don't
-- expose a clean shape for paginated UI reads. We dual-write into a flat table
-- so the chat history endpoint can use SQL pagination, and so analytics /
-- admin dashboards can join on user/thread without unmarshalling checkpoints.
-- LangGraph checkpoints continue to drive agent memory + resumption only.
-- =============================================================================

-- ── agent_runs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- 'running' | 'completed' | 'failed' | 'cancelled'
    status VARCHAR(20) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error TEXT,
    CONSTRAINT agent_runs_status_check
        CHECK (status IN ('running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_id
    ON public.agent_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_id
    ON public.agent_runs(user_id);
-- Partial index over running rows so the boot-recovery sweep is O(running)
-- instead of O(all runs).
CREATE INDEX IF NOT EXISTS idx_agent_runs_running
    ON public.agent_runs(id) WHERE status = 'running';

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own agent runs"
ON public.agent_runs FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- INSERT / UPDATE / DELETE are performed exclusively by the NestJS backend
-- using the service-role key (which bypasses RLS). No mutation policies are
-- defined on purpose — the anon/authenticated keys cannot mutate this table.

-- ── messages ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
    -- Nullable: tool/system rows may be re-attributed later if a run is purged.
    run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- 'user' | 'assistant' | 'tool' | 'system'
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    -- Populated only on tool-call / tool-result rows:
    tool_name VARCHAR(100),
    tool_call_id VARCHAR(255),
    tool_input JSONB,
    tool_output JSONB,
    token_count INT,
    -- Per-thread monotonic ordering computed at insert time. Cursor pagination
    -- keys off this so older pages never shift.
    sequence INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT messages_role_check
        CHECK (role IN ('user', 'assistant', 'tool', 'system')),
    CONSTRAINT messages_sequence_unique
        UNIQUE (thread_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_id_sequence
    ON public.messages(thread_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_messages_run_id
    ON public.messages(run_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id
    ON public.messages(user_id);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own messages"
ON public.messages FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Same as agent_runs: writes go through the service-role key only.

-- =============================================================================
-- Verification queries (run these to confirm setup)
-- =============================================================================
-- SELECT * FROM public.agent_runs LIMIT 5;
-- SELECT * FROM public.messages LIMIT 5;
-- SELECT * FROM pg_policies WHERE tablename IN ('agent_runs', 'messages');
-- SELECT indexname FROM pg_indexes
--   WHERE tablename IN ('agent_runs', 'messages') ORDER BY indexname;
