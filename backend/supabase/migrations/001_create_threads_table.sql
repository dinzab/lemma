-- =============================================================================
-- Threads Table Migration for BacPrep AI
-- =============================================================================
-- Run this SQL in your Supabase Dashboard SQL Editor
-- Dashboard: https://supabase.com/dashboard/project/{your-project-ref}/sql
-- =============================================================================

-- Create threads table for storing chat thread metadata
CREATE TABLE IF NOT EXISTS public.threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create index for faster user-based queries
CREATE INDEX IF NOT EXISTS idx_threads_user_id ON public.threads(user_id);
CREATE INDEX IF NOT EXISTS idx_threads_created_at ON public.threads(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only SELECT their own threads
CREATE POLICY "Users can view their own threads"
ON public.threads FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- RLS Policy: Users can only INSERT their own threads
CREATE POLICY "Users can create their own threads"
ON public.threads FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can only UPDATE their own threads
CREATE POLICY "Users can update their own threads"
ON public.threads FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- RLS Policy: Users can only DELETE their own threads
CREATE POLICY "Users can delete their own threads"
ON public.threads FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Create updated_at trigger function (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to threads table
DROP TRIGGER IF EXISTS update_threads_updated_at ON public.threads;
CREATE TRIGGER update_threads_updated_at
    BEFORE UPDATE ON public.threads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- Verification: Run these queries to verify the setup
-- =============================================================================
-- SELECT * FROM public.threads LIMIT 5;
-- SELECT * FROM pg_policies WHERE tablename = 'threads';
