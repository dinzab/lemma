"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  ListTodo,
} from "lucide-react";
import type { UIMessage } from "ai";

import { cn } from "@/lib/utils";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

/**
 * Walk the message stream and return the most recent `write_todos`
 * tool input. The agent emits the full list on every call (each call
 * replaces the prior one), so the latest one is the source of truth.
 *
 * Returns `null` when the agent hasn't written a plan in this thread —
 * the panel stays hidden in that case.
 */
export function extractCurrentTodos(messages: UIMessage[]): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    for (let j = m.parts.length - 1; j >= 0; j--) {
      const part = m.parts[j] as {
        type?: string;
        toolName?: string;
        input?: unknown;
      };
      const isWriteTodos =
        (part.type === "dynamic-tool" && part.toolName === "write_todos") ||
        part.type === "tool-write_todos";
      if (!isWriteTodos) continue;
      const input = part.input as { todos?: unknown } | undefined;
      if (!input || !Array.isArray(input.todos)) continue;
      const todos = (input.todos as unknown[])
        .map((t) => normaliseTodo(t))
        .filter((t): t is TodoItem => t !== null);
      if (todos.length === 0) continue;
      return todos;
    }
  }
  return null;
}

function normaliseTodo(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { content?: unknown; status?: unknown };
  if (typeof r.content !== "string" || r.content.length === 0) return null;
  const status =
    r.status === "in_progress" || r.status === "completed"
      ? r.status
      : "pending";
  return { content: r.content, status };
}

/**
 * Live-updating plan panel rendered above the chat transcript. Mirrors
 * the deepagents / langchain `write_todos` UX: the assistant emits a
 * structured task list, statuses tick from `pending` → `in_progress` →
 * `completed` as work progresses, and the student sees the agent's plan
 * unfold in real time.
 *
 * Collapsible by default once all items are completed so it doesn't
 * dominate the screen on a finished turn — but stays expanded while
 * anything is still in flight.
 */
export function TodoPlanPanel({ todos }: { todos: TodoItem[] }) {
  const stats = useMemo(() => summarise(todos), [todos]);
  const allDone = stats.completed === stats.total && stats.total > 0;
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const effectivelyCollapsed = collapsed || (allDone && !stats.inProgress);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-3">
      <div className="rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
          aria-expanded={!effectivelyCollapsed}
        >
          <ListTodo className="size-4 text-primary" aria-hidden />
          <span className="flex-1 text-sm font-medium text-foreground">
            Plan
          </span>
          <span className="text-xs text-muted-foreground">
            {stats.completed}/{stats.total}
            {stats.inProgress > 0 ? ` · ${stats.inProgress} in progress` : ""}
          </span>
          {effectivelyCollapsed ? (
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          )}
        </button>
        {!effectivelyCollapsed && (
          <ol className="flex flex-col gap-1.5 px-4 pb-3">
            {todos.map((todo, idx) => (
              <li
                key={`${idx}-${todo.content}`}
                className="flex items-start gap-2.5 text-sm"
              >
                <StatusIcon status={todo.status} />
                <span
                  className={cn(
                    "flex-1 leading-snug",
                    todo.status === "completed"
                      ? "text-muted-foreground line-through decoration-muted-foreground/60"
                      : todo.status === "in_progress"
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {todo.content}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function summarise(todos: TodoItem[]): {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
} {
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  for (const t of todos) {
    if (t.status === "completed") completed += 1;
    else if (t.status === "in_progress") inProgress += 1;
    else pending += 1;
  }
  return { total: todos.length, completed, inProgress, pending };
}

function StatusIcon({ status }: { status: TodoStatus }) {
  if (status === "completed") {
    return (
      <CircleCheck
        className="mt-0.5 size-4 shrink-0 text-primary"
        aria-label="Completed"
      />
    );
  }
  if (status === "in_progress") {
    return (
      <CircleDashed
        className="mt-0.5 size-4 shrink-0 animate-spin text-primary [animation-duration:2s]"
        aria-label="In progress"
      />
    );
  }
  return (
    <Circle
      className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
      aria-label="Pending"
    />
  );
}
