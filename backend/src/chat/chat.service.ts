import { Injectable, Logger } from '@nestjs/common';
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import type { ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { AgentService } from '../agent/agent.service';
import { CheckpointerService } from '../agent/checkpointer.service';
import { ThreadsService } from '../threads/threads.service';
import type { MessageDto, MessagesPageDto } from './dto';

/**
 * ChatService — orchestrates the live streaming run and the paginated read
 * path. It deliberately does NOT own state; all persistence lives in the
 * shared CheckpointerService.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly agent: AgentService,
    private readonly checkpointer: CheckpointerService,
    private readonly threads: ThreadsService,
  ) {}

  /**
   * Pipe a Vercel AI SDK UI message stream for a single agent turn into the
   * given Express response. Validates thread ownership first; the controller
   * surfaces the throw as a 403 / 404 / 500 before any SSE bytes go out.
   */
  async streamRunToResponse(opts: {
    threadId: string;
    userId: string;
    message: string;
    response: ServerResponse;
  }): Promise<void> {
    const { threadId, userId, message, response } = opts;

    // Throws ThreadNotFoundException / ThreadAccessDeniedException — let the
    // controller's exception filters render the right HTTP status.
    await this.threads.getThread(threadId, userId);

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Surface a stable id for the assistant's reply turn so the client
        // can correlate streamed deltas to a single message bubble.
        const turnId = randomUUID();
        let textOpen = false;
        const openTextOnce = () => {
          if (!textOpen) {
            writer.write({ type: 'start' });
            writer.write({ type: 'text-start', id: turnId });
            textOpen = true;
          }
        };

        try {
          for await (const event of this.agent.streamRun(threadId, message)) {
            if (event.mode === 'messages') {
              // Tuple of [chunk, metadata] from streamMode=messages.
              const tuple = event.payload as [AIMessageChunk | unknown, unknown];
              const chunk = tuple[0];
              if (chunk instanceof AIMessageChunk) {
                const delta = chunkToText(chunk);
                if (delta) {
                  openTextOnce();
                  writer.write({
                    type: 'text-delta',
                    id: turnId,
                    delta,
                  });
                }
              }
              continue;
            }

            if (event.mode === 'updates') {
              // Tool call / tool result side-channel. Payload shape:
              //   { node_name: { messages: BaseMessage[] } }
              const updates = event.payload as Record<
                string,
                { messages?: BaseMessage[] }
              >;
              for (const [, stateUpdate] of Object.entries(updates)) {
                for (const m of stateUpdate.messages ?? []) {
                  if (
                    m instanceof AIMessage &&
                    m.tool_calls &&
                    m.tool_calls.length > 0
                  ) {
                    for (const tc of m.tool_calls) {
                      writer.write({
                        type: 'tool-input-available',
                        toolCallId: tc.id ?? randomUUID(),
                        toolName: tc.name,
                        input: tc.args,
                        dynamic: true,
                      });
                    }
                  } else if (m instanceof ToolMessage) {
                    writer.write({
                      type: 'tool-output-available',
                      toolCallId: m.tool_call_id,
                      output: safeParse(m.content as string),
                      dynamic: true,
                    });
                  }
                }
              }
            }
          }
        } finally {
          if (textOpen) {
            writer.write({ type: 'text-end', id: turnId });
          }
          writer.write({ type: 'finish' });
        }
      },
      onError: (err) => {
        this.logger.error(`stream execute failed: ${String(err)}`);
        return 'The tutor is temporarily unavailable. Please retry.';
      },
    });

    pipeUIMessageStreamToResponse({ response, stream });
  }

  /**
   * Cursor-paginated message read. Newest messages first; pass the returned
   * `nextCursor` back as `before` to walk further into history.
   */
  async getMessagesPage(
    threadId: string,
    userId: string,
    opts: { limit?: number; before?: string },
  ): Promise<MessagesPageDto> {
    await this.threads.getThread(threadId, userId);

    const page = await this.checkpointer.getMessages(threadId, opts);
    return {
      messages: page.messages.map(toMessageDto),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }
}

function chunkToText(chunk: AIMessageChunk): string {
  const c = chunk.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part) =>
        typeof part === 'string'
          ? part
          : 'text' in part && typeof part.text === 'string'
            ? part.text
            : '',
      )
      .join('');
  }
  return '';
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toMessageDto(message: BaseMessage): MessageDto {
  const id = (message as { id?: string }).id ?? randomUUID();
  const content =
    typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);

  if (message instanceof HumanMessage) {
    return { id, role: 'user', content };
  }
  if (message instanceof AIMessage) {
    return {
      id,
      role: 'assistant',
      content,
      toolCalls: message.tool_calls?.map((tc) => ({
        id: tc.id ?? '',
        name: tc.name,
        args: (tc.args ?? {}) as Record<string, unknown>,
      })),
    };
  }
  if (message instanceof ToolMessage) {
    return {
      id,
      role: 'tool',
      content,
      toolCallId: message.tool_call_id,
      toolName: message.name,
    };
  }
  if (message instanceof SystemMessage) {
    return { id, role: 'system', content };
  }
  return { id, role: 'assistant', content };
}
