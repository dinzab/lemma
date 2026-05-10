"use client";

import { useMemo } from "react";
import { GraduationCap, Sparkles } from "lucide-react";
import type { UIMessage } from "ai";

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
import { LemmaToolCall } from "@/components/chat/LemmaToolCall";
import type { LemmaToolUIPart } from "@/components/chat/LemmaToolCall";
import {
  RealLifeAnchorChip,
  type LemmaAnalogyToolPart,
} from "@/components/chat/RealLifeAnchorChip";
import {
  PastPaperChip,
  type LemmaSearchQuestionsToolPart,
} from "@/components/chat/PastPaperChip";
import {
  ThinkingPatternChip,
  type LemmaPatternToolPart,
} from "@/components/chat/ThinkingPatternChip";
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
  emptyTitle = "Start a conversation",
  emptyDescription = "Ask me anything about your Baccalaureate studies",
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
                if (isRecallAnalogyPart(part)) {
                  // A12 *Dans la vraie vie* surface — render the
                  // curated anchor as a soft pinned card instead of
                  // the generic debug-style tool chip.
                  return (
                    <RealLifeAnchorChip
                      key={key}
                      part={part as LemmaAnalogyToolPart}
                    />
                  );
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
                if (isRecallPatternPart(part)) {
                  // A11 *Comment penser à ça* surface — render the
                  // canonical thinking-frame (genre + recipe + trap)
                  // as a pinned card before the assistant's prose.
                  // Chip itself returns null for `covered: false`.
                  return (
                    <ThinkingPatternChip
                      key={key}
                      part={part as LemmaPatternToolPart}
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
                <TypingIndicator />
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

function isRecallAnalogyPart(part: {
  type?: string;
  toolName?: string;
}): boolean {
  if (part.type === "dynamic-tool" && part.toolName === "recall_analogy") {
    return true;
  }
  return part.type === "tool-recall_analogy";
}

function isRecallPatternPart(part: {
  type?: string;
  toolName?: string;
}): boolean {
  if (part.type === "dynamic-tool" && part.toolName === "recall_pattern") {
    return true;
  }
  return part.type === "tool-recall_pattern";
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

function TypingIndicator() {
  return (
    <div
      className="flex items-center gap-1 py-1.5 text-muted-foreground"
      aria-label="Tutor is thinking"
      role="status"
    >
      <span className="size-1.5 animate-bounce rounded-full bg-primary/80 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-primary/80 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-primary/80" />
    </div>
  );
}
