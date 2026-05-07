"use client";

import type { DynamicToolUIPart, ToolUIPart } from "ai";

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
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
 * Collapsible tool indicator using AI Elements.
 *
 * The header surfaces tool name, status, and a result-count chip so
 * the chat surface stays uncluttered. Expanding the row reveals both
 * the input parameters the agent dispatched AND the raw output it
 * received — surfacing the output is important for transparency and
 * makes the agent's behaviour debuggable, both for the student and
 * for whoever is iterating on the prompt / tools.
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

  // ToolOutput requires both `output` and `errorText` props even when
  // the call hasn't returned yet — the component renders nothing if
  // neither is present, so we wire them through unconditionally.
  const errorText = "errorText" in part ? part.errorText : undefined;

  if (isDynamic) {
    return (
      <Tool defaultOpen={part.state === "input-available"}>
        <ToolHeader
          type="dynamic-tool"
          state={part.state}
          toolName={toolName}
          title={title}
        />
        <ToolContent>
          <ToolInput input={part.input} />
          <ToolOutput output={part.output} errorText={errorText} />
        </ToolContent>
      </Tool>
    );
  }

  return (
    <Tool defaultOpen={part.state === "input-available"}>
      <ToolHeader type={part.type} state={part.state} title={title} />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput output={part.output} errorText={errorText} />
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
