"use client";

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
  const lastMessage = messages[messages.length - 1];
  const lastIsUser = lastMessage?.role === "user";
  const showAssistantTyping = isLoading && (lastIsUser || !lastMessage);

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
                  // Rendered as the live plan panel above the chat
                  // (see <TodoPlanPanel />); inline duplication would
                  // be noisy and reveal an internal tool name.
                  return null;
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

          return isAssistant ? (
            <div
              key={message.id}
              className="flex w-full items-start gap-3"
            >
              <AssistantAvatar className="mt-0.5" />
              <Message from="assistant" className="flex-1 min-w-0">
                <MessageContent>{renderedParts}</MessageContent>
              </Message>
            </div>
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
