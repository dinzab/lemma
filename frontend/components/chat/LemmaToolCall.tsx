"use client";

import { useState, type ReactNode } from "react";
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
  recall_analogy: "Recalling a real-life analogy",
  recall_pattern: "Recalling the canonical recipe",
  emit_hint_ladder: "Building a hint ladder",
  emit_solution_steps: "Laying out the worked solution",
};

/**
 * Collapsible tool indicator using AI Elements.
 *
 * The header surfaces tool name, status, and a result-count chip so
 * the chat surface stays uncluttered. Chips are **collapsed by
 * default**: the student sees a clean one-line affordance like
 * `Listing chapters — 13 chapters · Completed` and only opens the
 * body if they want to peek inside.
 *
 * For high-volume catalogue tools (list_chapters / list_topics /
 * list_exams / count_questions) the expanded body renders a
 * student-friendly structured summary instead of a raw JSON dump.
 * Tools without a custom renderer fall back to the AI Elements
 * `<ToolInput>` + `<ToolOutput>` JSON view so the surface stays
 * debuggable.
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
  const friendlyBody = renderFriendlyBody(toolName, part);

  if (isDynamic) {
    return (
      <Tool defaultOpen={false}>
        <ToolHeader
          type="dynamic-tool"
          state={part.state}
          toolName={toolName}
          title={title}
        />
        <ToolContent>
          {friendlyBody ?? (
            <>
              <ToolInput input={part.input} />
              <ToolOutput output={part.output} errorText={errorText} />
            </>
          )}
        </ToolContent>
      </Tool>
    );
  }

  return (
    <Tool defaultOpen={false}>
      <ToolHeader type={part.type} state={part.state} title={title} />
      <ToolContent>
        {friendlyBody ?? (
          <>
            <ToolInput input={part.input} />
            <ToolOutput output={part.output} errorText={errorText} />
          </>
        )}
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

// ---- friendly per-tool body renderers --------------------------------

const PREVIEW_LIMIT = 6;

interface ChapterRow {
  chapter: string;
  matiere?: string;
  pair_count?: number;
}
interface TopicRow {
  topic: string;
  matiere?: string;
  pair_count?: number;
}
interface ExamRow {
  exam_id?: string;
  year?: number;
  session?: string;
  subject?: string;
  track?: string;
  pair_count?: number;
}

/**
 * Per-tool structured renderer for the expanded chip body. Returns
 * `null` for tools without a custom renderer — the caller falls back
 * to the AI Elements raw-JSON view in that case.
 */
function renderFriendlyBody(
  toolName: string,
  part: LemmaToolUIPart,
): ReactNode | null {
  // While the tool is still streaming, there's nothing to summarise
  // yet — let the raw fallback render the (empty) input.
  const output = part.output;
  if (output === undefined || output === null) return null;
  if (typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  const input = (part.input ?? {}) as Record<string, unknown>;

  switch (toolName) {
    case "list_chapters": {
      const chapters = (o.chapters as ChapterRow[] | undefined) ?? [];
      return (
        <CatalogueList
          summary={summariseListChapters(input, chapters.length)}
          rows={chapters.map((c) => ({
            primary: c.chapter,
            secondary:
              c.matiere && !input.matiere
                ? `${c.matiere}${c.pair_count !== undefined ? ` · ${c.pair_count} exercises` : ""}`
                : c.pair_count !== undefined
                  ? `${c.pair_count} exercises`
                  : undefined,
          }))}
        />
      );
    }
    case "list_topics": {
      const topics = (o.topics as TopicRow[] | undefined) ?? [];
      return (
        <CatalogueList
          summary={summariseListTopics(input, topics.length)}
          rows={topics.map((t) => ({
            primary: t.topic,
            secondary:
              t.matiere && !input.matiere
                ? `${t.matiere}${t.pair_count !== undefined ? ` · ${t.pair_count} exercises` : ""}`
                : t.pair_count !== undefined
                  ? `${t.pair_count} exercises`
                  : undefined,
          }))}
        />
      );
    }
    case "list_exams": {
      const exams = (o.exams as ExamRow[] | undefined) ?? [];
      return (
        <CatalogueList
          summary={summariseListExams(input, exams.length)}
          rows={exams.map((e) => ({
            primary: formatExamPrimary(e),
            secondary:
              e.pair_count !== undefined
                ? `${e.pair_count} exercises`
                : undefined,
          }))}
        />
      );
    }
    case "count_questions": {
      if (typeof o.count !== "number") return null;
      return <CountSummary count={o.count} filters={input} />;
    }
    default:
      return null;
  }
}

interface CatalogueRow {
  primary: string;
  secondary?: string;
}

function CatalogueList({
  summary,
  rows,
}: {
  summary: string;
  rows: CatalogueRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, PREVIEW_LIMIT);
  const hidden = rows.length - visible.length;

  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {summary}. No matching entries — try widening the filters.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted-foreground">{summary}.</p>
      <ul className="flex flex-col gap-1 text-[13px] text-foreground">
        {visible.map((row, idx) => (
          <li
            key={`${idx}-${row.primary}`}
            className="flex items-baseline gap-2"
          >
            <span className="text-muted-foreground/60">·</span>
            <span className="flex-1 leading-snug">
              <span className="font-medium">{row.primary}</span>
              {row.secondary && (
                <span className="ml-2 text-muted-foreground">
                  {row.secondary}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[12px] font-medium text-primary hover:underline"
        >
          Show {hidden} more
        </button>
      )}
    </div>
  );
}

function CountSummary({
  count,
  filters,
}: {
  count: number;
  filters: Record<string, unknown>;
}) {
  const filterSummary = summariseFilters(filters);
  return (
    <div className="space-y-1">
      <p className="text-[13px] text-foreground">
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {count.toLocaleString()}
        </span>{" "}
        <span className="text-muted-foreground">
          matching {count === 1 ? "exercise" : "exercises"}
        </span>
      </p>
      {filterSummary && (
        <p className="text-[12px] text-muted-foreground">
          Filters: {filterSummary}
        </p>
      )}
    </div>
  );
}

function summariseListChapters(
  input: Record<string, unknown>,
  total: number,
): string {
  const matiere = stringField(input.matiere);
  const noun = `${total} chapter${total === 1 ? "" : "s"}`;
  return matiere ? `${noun} in ${matiere}` : noun;
}

function summariseListTopics(
  input: Record<string, unknown>,
  total: number,
): string {
  const parts: string[] = [];
  const matiere = stringField(input.matiere);
  const chapter = stringField(input.chapter);
  if (chapter) parts.push(`in ${chapter}`);
  else if (matiere) parts.push(`in ${matiere}`);
  const noun = `${total} topic${total === 1 ? "" : "s"}`;
  return parts.length ? `${noun} ${parts.join(" ")}` : noun;
}

function summariseListExams(
  input: Record<string, unknown>,
  total: number,
): string {
  const noun = `${total} exam${total === 1 ? "" : "s"}`;
  const filterSummary = summariseFilters(input);
  return filterSummary ? `${noun} matching ${filterSummary}` : noun;
}

function summariseFilters(input: Record<string, unknown>): string | null {
  const fragments: string[] = [];
  const matiere = stringField(input.matiere);
  if (matiere) fragments.push(matiere);
  const chapter = stringField(input.chapter);
  if (chapter) fragments.push(chapter);
  const topic = stringField(input.topic);
  if (topic) fragments.push(topic);
  const year = numberField(input.year);
  if (year !== null) fragments.push(String(year));
  const session = stringField(input.session);
  if (session) fragments.push(session);
  const track = stringField(input.track);
  if (track) fragments.push(track);
  return fragments.length ? fragments.join(" · ") : null;
}

function formatExamPrimary(e: ExamRow): string {
  const fragments: string[] = [];
  if (e.year !== undefined) fragments.push(String(e.year));
  if (e.session) fragments.push(e.session);
  if (e.subject) fragments.push(e.subject);
  if (e.track) fragments.push(e.track);
  if (fragments.length === 0) return e.exam_id ?? "Unknown exam";
  return fragments.join(" · ");
}

function stringField(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function numberField(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
