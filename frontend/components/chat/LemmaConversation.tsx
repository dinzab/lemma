"use client";

import { useEffect, useMemo } from "react";
import { GraduationCap, Sparkles } from "lucide-react";
import type { UIMessage } from "ai";

import {
  FigureRegistryProvider,
  useFigureRegistry,
} from "@/context/figure-registry-context";
import type { FigureKey, RegisteredFigure } from "@/context/figure-registry-context";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { LemmaToolCall } from "@/components/chat/LemmaToolCall";
import type { LemmaToolUIPart } from "@/components/chat/LemmaToolCall";
import {
  PastPaperChip,
  type LemmaSearchQuestionsToolPart,
} from "@/components/chat/PastPaperChip";
import {
  HintLadderChip,
  type LemmaHintLadderToolPart,
} from "@/components/chat/HintLadderChip";
import {
  StepwiseSolutionCards,
  type LemmaSolutionStepsToolPart,
} from "@/components/chat/StepwiseSolutionCards";
import {
  QuestionAssetsBlock,
  type LemmaShowQuestionAssetsToolPart,
} from "@/components/chat/QuestionAssetsBlock";
import {
  QuestionCard,
  canRenderAsQuestionCard,
  type LemmaGetQuestionPairToolPart,
} from "@/components/chat/QuestionCard";
import {
  TodoPlanPanel,
  extractTodosFromToolPart,
} from "@/components/chat/TodoPlanPanel";
import { cn } from "@/lib/utils";

interface LemmaConversationProps {
  messages: UIMessage[];
  isLoading?: boolean;
  isStreaming?: boolean;
  /**
   * True while the chat hook is auto-reconnecting to the in-memory
   * RunStreamHub after a dropped wire (page reload, WiFi flicker,
   * server hub eviction). Used to swap the bouncing-dots typing
   * indicator for an explicit “Reconnecting…” cue so the user
   * understands why the answer paused.
   */
  isReconnecting?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

function AssistantAvatar({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        "bg-gradient-to-br from-primary/15 via-secondary/15 to-chart-3/15 ring-1 ring-primary/20",
        className,
      )}
    >
      <GraduationCap className="size-3.5 text-primary" />
    </div>
  );
}

/**
 * Render the chat transcript using Vercel AI Elements primitives.
 *
 * Each `UIMessage` from the SDK is mapped to an AI Elements `<Message>`
 * with one `<MessageResponse>` (Streamdown for math + code + mermaid)
 * per text part and one `<LemmaToolCall>` per `dynamic-tool` /
 * `tool-*` part. We deliberately do NOT render full tool outputs to
 * the user — only a tool name + status + result count chip — but the
 * tool input is exposed in the collapsible body so power users can
 * inspect what the agent searched for.
 */
export function LemmaConversation({
  messages,
  isLoading = false,
  isStreaming = false,
  isReconnecting = false,
  emptyTitle = "Ready when you are",
  emptyDescription = "Ask anything about your Baccalaureate — past papers, methods, or that one exercise that's stuck.",
}: LemmaConversationProps) {
  // Keep the typing indicator (avatar + bouncing dots) visible for the
  // entire loading lifecycle — `submitted` AND `streaming` — instead of
  // hiding it the moment the SDK creates the assistant placeholder.
  // Without this the indicator vanished as soon as the first chunk
  // arrived, leaving the user with a blank gap until enough text had
  // streamed in to show — which the user reported as "loading dots and
  // the assistant icon were removed when the agent starts streaming".
  const showAssistantTyping = isLoading;

  // The agent emits the entire plan state on every `write_todos`
  // call, so older calls are superseded by later ones. Render the
  // plan panel inline only at the most recent `write_todos` part —
  // earlier ones in the stream collapse to nothing.
  const latestWriteTodosLocation = useMemo(
    () => findLatestWriteTodosLocation(messages),
    [messages],
  );

  if (messages.length === 0 && !isLoading) {
    return (
      <Conversation>
        <ConversationContent>
          <ConversationEmptyState
            icon={<Sparkles className="size-8 text-primary" />}
            title={emptyTitle}
            description={emptyDescription}
          />
        </ConversationContent>
      </Conversation>
    );
  }

  return (
    <FigureRegistryProvider>
      <FigureCollector messages={messages} />
      <ConversationInner
        messages={messages}
        showAssistantTyping={showAssistantTyping}
        latestWriteTodosLocation={latestWriteTodosLocation}
        isStreaming={isStreaming}
        isReconnecting={isReconnecting}
      />
    </FigureRegistryProvider>
  );
}

/**
 * Side-effect-only component: walks the conversation's tool parts and
 * registers every figure surfaced through `search_questions`,
 * `get_question_pair`, `show_question_assets`, or `inspect_figure`
 * into the FigureRegistry. The inline `lemma:fig:…` chip in
 * `MessageResponse` reads from that registry to render a
 * click-to-zoom thumbnail next to the prose.
 */
function FigureCollector({ messages }: { messages: UIMessage[] }) {
  const { registerFigure } = useFigureRegistry();
  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        const partType = (part as { type?: string }).type;
        if (
          partType !== "dynamic-tool" &&
          (typeof partType !== "string" || !partType.startsWith("tool-"))
        ) {
          continue;
        }
        const output = (part as { output?: unknown }).output;
        if (output === undefined || output === null) continue;
        for (const reg of collectFigureRegistrations(output)) {
          registerFigure(reg.key, reg.figure);
        }
      }
    }
  }, [messages, registerFigure]);
  return null;
}

interface ConversationInnerProps {
  messages: UIMessage[];
  showAssistantTyping: boolean;
  latestWriteTodosLocation: { messageIdx: number; partIdx: number } | null;
  isStreaming: boolean;
  isReconnecting: boolean;
}

function ConversationInner({
  messages,
  showAssistantTyping,
  latestWriteTodosLocation,
  isStreaming,
  isReconnecting,
}: ConversationInnerProps) {
  return (
    <Conversation>
      <ConversationContent className="mx-auto w-full max-w-3xl">
        {messages.map((message, idx) => {
          const isLastMessage = idx === messages.length - 1;
          const messageIsStreaming = isStreaming && isLastMessage;
          const isAssistant = message.role === "assistant";
          const renderedParts = message.parts
            .map((part, partIdx) => {
              const key = `${message.id}-${partIdx}`;
              if (part.type === "text") {
                return (
                  <MessageResponse key={key}>{part.text}</MessageResponse>
                );
              }
              if (part.type === "reasoning") {
                // The chat loop emits `reasoning-*` SSE events while
                // the model is thinking; without this branch the
                // accumulated `{ type: "reasoning", text, state }`
                // part would be silently dropped from the transcript.
                // We collapse the live thinking into the standard AI
                // Elements collapsible — auto-opens while streaming,
                // auto-closes a beat after `reasoning-end`. Settled
                // assistant turns reloaded from the DB never carry
                // reasoning parts (we don't persist them), so this
                // surface is intrinsically stream-only.
                const partState = (part as { state?: string }).state;
                const text = (part as { text?: string }).text ?? "";
                if (text.length === 0 && partState !== "streaming") {
                  return null;
                }
                return (
                  <Reasoning
                    key={key}
                    isStreaming={partState === "streaming"}
                  >
                    <ReasoningTrigger />
                    <ReasoningContent>{text}</ReasoningContent>
                  </Reasoning>
                );
              }
              if (
                part.type === "dynamic-tool" ||
                (typeof part.type === "string" &&
                  part.type.startsWith("tool-"))
              ) {
                if (isWriteTodosPart(part)) {
                  // Inline plan panel — render only at the latest
                  // `write_todos` part (the agent emits the full
                  // plan state on each call, so earlier calls are
                  // superseded). At every other write_todos part we
                  // render nothing.
                  if (
                    !latestWriteTodosLocation ||
                    latestWriteTodosLocation.messageIdx !== idx ||
                    latestWriteTodosLocation.partIdx !== partIdx
                  ) {
                    return null;
                  }
                  const todos = extractTodosFromToolPart(
                    part as { input?: unknown },
                  );
                  if (!todos) return null;
                  return <TodoPlanPanel key={key} todos={todos} />;
                }
                if (isSearchQuestionsPart(part)) {
                  // A2 *Passage du BAC* surface — render the top
                  // matching past-paper question as a soft pinned
                  // card. Pairs visually with the analogy chip; the
                  // chip itself decides whether the match is strong
                  // enough to surface (else renders nothing).
                  return (
                    <PastPaperChip
                      key={key}
                      part={part as LemmaSearchQuestionsToolPart}
                    />
                  );
                }
                if (isEmitHintLadderPart(part)) {
                  // A1 *Hint Ladder* surface — render the agent's
                  // four-rung scaffold as a stacked accordion. The
                  // chip suppresses itself while still streaming and
                  // when any rung is missing, so the assistant's
                  // prose can still render through.
                  return (
                    <HintLadderChip
                      key={key}
                      part={part as LemmaHintLadderToolPart}
                    />
                  );
                }
                if (isEmitSolutionStepsPart(part)) {
                  // A4 *Stepwise Solution Cards* surface — render the
                  // agent's worked solution as a numbered, folded
                  // card stack. Suppresses itself while streaming or
                  // when any step is missing required fields, so
                  // half-built stacks never reach the student.
                  return (
                    <StepwiseSolutionCards
                      key={key}
                      part={part as LemmaSolutionStepsToolPart}
                    />
                  );
                }
                if (isShowQuestionAssetsPart(part)) {
                  // *Voir l'épreuve* surface — render the figure
                  // panel (énoncé / corrigé gated / exam complet)
                  // when the agent calls `show_question_assets`.
                  // Pairs with the passive thumbnail rendered by
                  // `<PastPaperChip>`; the explicit panel is the
                  // (C) half of the hybrid figure-surfacing pattern.
                  return (
                    <QuestionAssetsBlock
                      key={key}
                      part={part as LemmaShowQuestionAssetsToolPart}
                    />
                  );
                }
                if (
                  isGetQuestionPairPart(part) &&
                  canRenderAsQuestionCard(
                    part as LemmaGetQuestionPairToolPart,
                  )
                ) {
                  // *Question card* surface — render the full énoncé
                  // (text + figures) plus a recall-gated corrigé
                  // when the agent calls `get_question_pair`. The
                  // raw payload is a long JSON object that's useless
                  // as a tool-chip dump; this card is the structured
                  // student-facing equivalent. We only swap the chip
                  // out when the payload actually carries renderable
                  // content — error strings ("No question pair
                  // found…") and in-flight calls fall through to
                  // `<LemmaToolCall>` so the agent surface stays
                  // debuggable.
                  return (
                    <QuestionCard
                      key={key}
                      part={part as LemmaGetQuestionPairToolPart}
                    />
                  );
                }
                return (
                  <LemmaToolCall
                    key={key}
                    part={part as LemmaToolUIPart}
                    isStreaming={messageIsStreaming}
                  />
                );
              }
              return null;
            })
            .filter(Boolean);

          if (renderedParts.length === 0) {
            return null;
          }

          // Assistant turns render full-width without the avatar chip
          // — the typing indicator below is the only place the avatar
          // shows, signalling "the tutor is currently speaking". Once
          // the turn settles we want the answer text to read cleanly,
          // not be flanked by a decorative icon column.
          return isAssistant ? (
            <Message
              from="assistant"
              key={message.id}
              className="w-full min-w-0"
            >
              <MessageContent>{renderedParts}</MessageContent>
            </Message>
          ) : (
            <Message from={message.role} key={message.id}>
              <MessageContent>{renderedParts}</MessageContent>
            </Message>
          );
        })}

        {showAssistantTyping && (
          <div
            className="flex w-full items-start gap-3"
            key="assistant-typing"
          >
            <AssistantAvatar className="mt-0.5" />
            <Message from="assistant" className="flex-1 min-w-0">
              <MessageContent>
                <TypingIndicator reconnecting={isReconnecting} />
              </MessageContent>
            </Message>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

function isWriteTodosPart(part: { type?: string; toolName?: string }): boolean {
  if (part.type === "dynamic-tool" && part.toolName === "write_todos") {
    return true;
  }
  return part.type === "tool-write_todos";
}

function findLatestWriteTodosLocation(
  messages: UIMessage[],
): { messageIdx: number; partIdx: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    for (let j = message.parts.length - 1; j >= 0; j--) {
      if (isWriteTodosPart(message.parts[j])) {
        return { messageIdx: i, partIdx: j };
      }
    }
  }
  return null;
}

function isEmitSolutionStepsPart(part: {
  type?: string;
  toolName?: string;
}): boolean {
  if (
    part.type === "dynamic-tool" &&
    part.toolName === "emit_solution_steps"
  ) {
    return true;
  }
  return part.type === "tool-emit_solution_steps";
}

function isEmitHintLadderPart(part: {
  type?: string;
  toolName?: string;
}): boolean {
  if (part.type === "dynamic-tool" && part.toolName === "emit_hint_ladder") {
    return true;
  }
  return part.type === "tool-emit_hint_ladder";
}

function isSearchQuestionsPart(part: {
  type?: string;
  toolName?: string;
}): boolean {
  if (part.type === "dynamic-tool" && part.toolName === "search_questions") {
    return true;
  }
  return part.type === "tool-search_questions";
}

function isShowQuestionAssetsPart(part: {
  type?: string;
  toolName?: string;
}): boolean {
  if (
    part.type === "dynamic-tool" &&
    part.toolName === "show_question_assets"
  ) {
    return true;
  }
  return part.type === "tool-show_question_assets";
}

function isGetQuestionPairPart(part: {
  type?: string;
  toolName?: string;
}): boolean {
  if (
    part.type === "dynamic-tool" &&
    part.toolName === "get_question_pair"
  ) {
    return true;
  }
  return part.type === "tool-get_question_pair";
}

function TypingIndicator({ reconnecting = false }: { reconnecting?: boolean }) {
  // While auto-reconnect is in flight we swap the regular bouncing
  // dots for a labelled “Reconnecting…” row so the user understands
  // why the answer paused (vs. the model just thinking). The dots
  // stay so the row keeps its rhythm even on the labelled variant.
  return (
    <div
      className="flex items-center gap-2 py-1.5 text-muted-foreground"
      aria-label={reconnecting ? "Reconnecting to tutor" : "Tutor is thinking"}
      role="status"
    >
      <div className="flex items-center gap-1">
        <span className="size-1.5 animate-bounce rounded-full bg-primary/80 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary/80 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary/80" />
      </div>
      {reconnecting && (
        <span className="text-xs font-medium">Reconnecting…</span>
      )}
    </div>
  );
}

interface RawFigureEntry {
  url?: string | null;
  label?: string | null;
  caption?: string | null;
  citation?: { ref_uri?: string | null } | null;
}

interface RawFigurePayload {
  pair_id?: string | null;
  figures?: {
    enonce?: RawFigureEntry[] | null;
    corrige?: RawFigureEntry[] | null;
  } | null;
  // search_questions returns { results: RawFigurePayload[] }
  results?: RawFigurePayload[] | null;
  // inspect_figure returns { figures: RawFigureEntry[] } at top level
  // alongside the standalone-figure shape — handled separately below.
}

/**
 * Walk one tool-call output and emit a flat list of figure
 * registrations for the FigureRegistry. We try to recognise three
 * shapes:
 *
 *  1. `formatPairForLLM` (used by `get_question_pair`,
 *     `show_question_assets`, and embedded under `results[]` for
 *     `search_questions`) — a `pair_id` + `figures.{enonce,corrige}[]`.
 *  2. `inspect_figure` — a top-level `pair_id` + a flat `figures[]`
 *     where each entry already carries its own
 *     `citation.ref_uri` (`lemma:fig:…`) so we use that as the
 *     canonical key without re-deriving side / index from the array
 *     position.
 *  3. anything else — quietly ignored.
 *
 * Defensive against malformed shapes — every level is optional so
 * we can register what we can and skip the rest.
 */
function collectFigureRegistrations(
  output: unknown,
): { key: FigureKey; figure: RegisteredFigure }[] {
  const out: { key: FigureKey; figure: RegisteredFigure }[] = [];
  const parsed = parseToolOutput(output);
  if (!parsed || typeof parsed !== "object") return out;

  // Shape 3 is handled by the catch-all early-return; we now handle 1 & 2.
  const root = parsed as RawFigurePayload & {
    figures?: RawFigureEntry[] | { enonce?: RawFigureEntry[] | null; corrige?: RawFigureEntry[] | null } | null;
  };

  // search_questions: walk results[]
  if (Array.isArray(root.results)) {
    for (const r of root.results) {
      if (!r || typeof r !== "object") continue;
      out.push(...registrationsForPair(r));
    }
  }

  // get_question_pair / show_question_assets: top-level pair shape
  out.push(...registrationsForPair(root));

  // inspect_figure: top-level `figures` is a flat array of entries
  // each carrying a `citation.ref_uri` like
  // `lemma:fig:<exam>:<exercise>:<side>:<index>`.
  if (Array.isArray(root.figures)) {
    for (const fig of root.figures) {
      if (!fig || typeof fig !== "object") continue;
      const refUri = fig.citation?.ref_uri ?? null;
      const key = parseFigureRefUri(refUri);
      if (!key) continue;
      const url = typeof fig.url === "string" ? fig.url : null;
      if (!url) continue;
      out.push({
        key,
        figure: {
          url,
          alt: fig.label ?? "Figure",
          caption: fig.caption ?? null,
          shortLabel: fig.label ?? "Figure",
          label: fig.label ?? "Figure",
        },
      });
    }
  }

  return out;
}

/**
 * Emit FigureRegistry entries for one pair-shaped payload. Reads
 * `pair_id` + `figures.{enonce,corrige}[]` and keys each figure by
 * `<pair_id>:<side>:<0-based-index>` to mirror the `lemma:fig:…`
 * citation grammar.
 */
function registrationsForPair(
  payload: RawFigurePayload,
): { key: FigureKey; figure: RegisteredFigure }[] {
  const out: { key: FigureKey; figure: RegisteredFigure }[] = [];
  const pair_id = typeof payload.pair_id === "string" ? payload.pair_id : null;
  if (!pair_id) return out;
  // The `lemma:fig:…` URI grammar drops the question handle —
  // figures live on an exercise, not on a sub-question. Register
  // both the synthetic exercise handle (the prefix the chip parses
  // out of the URI) AND the full pair_id (so future variants of the
  // citation grammar that include the question handle still resolve)
  // — both point at the same RegisteredFigure entry.
  const exerciseHandle = exerciseHandleFromPairId(pair_id);
  const figs = payload.figures;
  if (!figs || typeof figs !== "object" || Array.isArray(figs)) return out;
  for (const side of ["enonce", "corrige"] as const) {
    const list = figs[side];
    if (!Array.isArray(list)) continue;
    list.forEach((fig, index) => {
      if (!fig || typeof fig !== "object") return;
      const url = typeof fig.url === "string" ? fig.url : null;
      if (!url) return;
      const sideLabel = side === "enonce" ? "l'énoncé" : "la correction";
      const figure: RegisteredFigure = {
        url,
        alt: fig.label ?? `figure ${index + 1} de ${sideLabel}`,
        caption: fig.caption ?? null,
        shortLabel: `figure ${index + 1} de ${sideLabel}`,
        label: fig.label ?? `figure ${index + 1} de ${sideLabel}`,
      };
      out.push({ key: { pair_id, side, index }, figure });
      if (exerciseHandle && exerciseHandle !== pair_id) {
        out.push({
          key: { pair_id: exerciseHandle, side, index },
          figure,
        });
      }
    });
  }
  return out;
}

/**
 * Given a v6 pair_id (e.g. `math-2024-principale-math:ex_1:q_1.a`),
 * return the exercise-only handle (`math-2024-principale-math:ex_1`).
 * The figure citation URI uses the latter, so the FigureRegistry
 * needs an entry under that key for the chip lookup to hit.
 */
function exerciseHandleFromPairId(pairId: string): string | null {
  const parts = pairId.split(":");
  if (parts.length < 2) return null;
  return `${parts[0]}:${parts[1]}`;
}

function parseToolOutput(output: unknown): unknown {
  if (typeof output === "string") {
    try {
      return JSON.parse(output);
    } catch {
      return null;
    }
  }
  return output;
}

/**
 * Parse a `lemma:fig:<exam>:<exercise>:<side>:<index>` URI back into
 * a FigureRegistry key. Returns null for any non-`lemma:fig:…` URI
 * or a malformed one.
 *
 * The pair_id is recomposed from `<exam>:<exercise>:<question>` —
 * but figure URIs only carry `<exam>:<exercise>` (no question
 * handle), so we can't reconstruct a full pair_id here. Instead we
 * register figures keyed by the synthetic pair handle
 * `<exam>:<exercise>` for inspect_figure-style entries; the chip
 * lookup uses the same synthetic handle when the URI lacks a
 * question handle.
 */
function parseFigureRefUri(refUri: string | null | undefined): FigureKey | null {
  if (typeof refUri !== "string") return null;
  if (!refUri.startsWith("lemma:fig:")) return null;
  const rest = refUri.slice("lemma:fig:".length);
  const parts = rest.split(":");
  if (parts.length < 4) return null;
  const index = Number.parseInt(parts[parts.length - 1], 10);
  const sideRaw = parts[parts.length - 2];
  if (sideRaw !== "enonce" && sideRaw !== "corrige") return null;
  if (!Number.isFinite(index) || index < 0) return null;
  // Everything before <side>:<index> is `<exam>:<exercise>` (the
  // exam handle itself contains hyphens but no colons in v6).
  const handle = parts.slice(0, parts.length - 2).join(":");
  if (!handle) return null;
  return { pair_id: handle, side: sideRaw, index };
}
