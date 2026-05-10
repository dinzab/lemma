-- =============================================================================
-- Persist streamed agent reasoning on `public.messages`
-- =============================================================================
-- Run this SQL in your Supabase Dashboard SQL Editor
-- Dashboard: https://supabase.com/dashboard/project/{your-project-ref}/sql
--
-- Adds:
--   - public.messages.reasoning TEXT
--
-- Rationale: ChatService already streams `reasoning-start` / `reasoning-delta`
-- / `reasoning-end` UI message chunks for assistant turns where the model
-- emits chain-of-thought (NVIDIA NIM / OpenAI o1 etc.), and the frontend
-- already renders these into an `<Reasoning>` collapsible while the turn is
-- live. But the reasoning was *only* on the wire — it never landed in the
-- messages table — so on reload the assistant's <Reasoning> collapsible was
-- empty.
--
-- We persist the buffered reasoning into a dedicated column on the same
-- `role: 'assistant'` row that ChatService already writes per text segment.
-- The frontend's history rehydrator (`toUiMessages`) emits a
-- `{ type: "reasoning", text, state: "done" }` UIMessage part whenever a
-- row has non-empty reasoning, so the collapsible is restored verbatim.
-- =============================================================================

ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS reasoning TEXT NOT NULL DEFAULT '';
