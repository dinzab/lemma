"use client";

import { Sparkles } from "lucide-react";
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

interface LemmaConversationProps {
  messages: UIMessage[];
  isLoading?: boolean;
  isStreaming?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
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
          return (
            <Message from={message.role} key={message.id}>
              <MessageContent>
                {message.parts.map((part, partIdx) => {
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
                    return (
                      <LemmaToolCall
                        key={key}
                        part={part as LemmaToolUIPart}
                        isStreaming={messageIsStreaming}
                      />
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          );
        })}

        {showAssistantTyping && (
          <Message from="assistant" key="assistant-typing">
            <MessageContent>
              <TypingIndicator />
            </MessageContent>
          </Message>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

function TypingIndicator() {
  return (
    <div
      className="flex items-center gap-1.5 py-1 text-muted-foreground"
      aria-label="Tutor is thinking"
    >
      <span className="size-2 animate-pulse rounded-full bg-primary/70 [animation-delay:-0.3s]" />
      <span className="size-2 animate-pulse rounded-full bg-primary/70 [animation-delay:-0.15s]" />
      <span className="size-2 animate-pulse rounded-full bg-primary/70" />
    </div>
  );
}
