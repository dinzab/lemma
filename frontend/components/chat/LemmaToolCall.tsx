"use client";

import type { DynamicToolUIPart, ToolUIPart } from "ai";

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
} from "@/components/ai-elements/tool";

export type LemmaToolUIPart = DynamicToolUIPart | ToolUIPart;

interface LemmaToolCallProps {
  part: LemmaToolUIPart;
  isStreaming?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  search_questions: "Searching past questions",
  get_question_pair: "Reading a question",
  find_similar_questions: "Looking up similar questions",
  count_questions: "Counting matching questions",
  list_chapters: "Listing chapters",
  list_topics: "Listing topics",
  list_exams: "Listing exams",
};

/**
 * Minimal collapsible tool indicator using AI Elements.
 *
 * Only the tool name, status, and a result-count badge are surfaced in
 * the header so the chat surface stays uncluttered. The collapsible
 * body shows the input parameters (e.g. which `matiere` / `chapter` /
 * `query` the agent dispatched) for transparency, but the raw tool
 * output is intentionally hidden — students don't need to see the
 * untransformed JSON, and exposing it makes prompt injection from the
 * corpus easier to notice.
 */
export function LemmaToolCall({ part }: LemmaToolCallProps) {
  const isDynamic = part.type === "dynamic-tool";
  const toolName = isDynamic
    ? part.toolName
    : part.type.slice("tool-".length);
  const label = TOOL_LABELS[toolName] ?? humaniseToolName(toolName);
  const resultCount = countResults(toolName, part.output);

  const title =
    resultCount === null
      ? label
      : `${label} — ${formatCount(toolName, resultCount)}`;

  if (isDynamic) {
    return (
      <Tool>
        <ToolHeader
          type="dynamic-tool"
          state={part.state}
          toolName={toolName}
          title={title}
        />
        <ToolContent>
          <ToolInput input={part.input} />
        </ToolContent>
      </Tool>
    );
  }

  return (
    <Tool>
      <ToolHeader type={part.type} state={part.state} title={title} />
      <ToolContent>
        <ToolInput input={part.input} />
      </ToolContent>
    </Tool>
  );
}

function humaniseToolName(name: string): string {
  return name
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/**
 * Pull a single integer "result count" out of the tool output payload
 * so the chip can render `searched questions — 5 results`.
 *
 * The shapes vary per tool (see `backend/src/agent/tools/index.ts`), so
 * we hard-code the field each tool uses rather than poking at random
 * keys. Returns `null` when no count makes sense (e.g. a single-record
 * fetch like `get_question_pair`).
 */
function countResults(toolName: string, output: unknown): number | null {
  if (output === undefined || output === null) return null;
  if (typeof output !== "object") return null;
  const o = output as Record<string, unknown>;

  switch (toolName) {
    case "search_questions":
    case "find_similar_questions":
      return arrayLen(o.results);
    case "list_chapters":
      return arrayLen(o.chapters);
    case "list_topics":
      return arrayLen(o.topics);
    case "list_exams":
      return arrayLen(o.exams);
    case "count_questions":
      return typeof o.count === "number" ? o.count : null;
    default:
      return null;
  }
}

function arrayLen(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function formatCount(toolName: string, count: number): string {
  if (toolName === "count_questions") {
    return `${count} match${count === 1 ? "" : "es"}`;
  }
  if (toolName === "list_chapters") {
    return `${count} chapter${count === 1 ? "" : "s"}`;
  }
  if (toolName === "list_topics") {
    return `${count} topic${count === 1 ? "" : "s"}`;
  }
  if (toolName === "list_exams") {
    return `${count} exam${count === 1 ? "" : "s"}`;
  }
  return `${count} result${count === 1 ? "" : "s"}`;
}
