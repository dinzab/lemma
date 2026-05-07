/**
 * Lifecycle states tracked on `public.agent_runs`. Mirrors the CHECK
 * constraint defined in migration 002.
 */
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentRunRecord {
  id: string;
  threadId: string;
  userId: string;
  status: AgentRunStatus;
  startedAt: Date;
  completedAt: Date | null;
  error: string | null;
}

export interface ActiveRunDto {
  runId: string | null;
  status: AgentRunStatus | 'idle';
}

interface AgentRunRow {
  id: string;
  thread_id: string;
  user_id: string;
  status: AgentRunStatus;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

export function rowToAgentRun(row: AgentRunRow): AgentRunRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    userId: row.user_id,
    status: row.status,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    error: row.error,
  };
}
