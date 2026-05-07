import { Injectable, Logger } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { LlmService } from './llm.service';
import { CheckpointerService } from './checkpointer.service';
import { AgentToolsService } from './tools';
import { buildGraph, type CompiledAgentGraph } from './graph';

/**
 * AgentService — owns the compiled LangGraph and exposes the two operations
 * the chat controller needs:
 *
 *   - streamRun(threadId, userMessage)  →  AsyncGenerator<event>
 *     drives a single agent turn with the new user message and yields token
 *     deltas / tool call events.
 *
 *   - getState(threadId)
 *     read-only snapshot of the latest checkpoint, used for hydrating the UI
 *     when a user opens an existing thread.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private graph?: CompiledAgentGraph;

  constructor(
    private readonly llm: LlmService,
    private readonly checkpointer: CheckpointerService,
    private readonly tools: AgentToolsService,
  ) {}

  /**
   * Lazily compile the graph on first use. Lazy because
   * `CheckpointerService.onModuleInit` is async (it runs `PostgresSaver
   * .setup()`), and Nest doesn't guarantee one provider's async init
   * completes before another's sync init runs in the same module.
   */
  private getGraph(): CompiledAgentGraph {
    if (!this.graph) {
      this.graph = buildGraph({
        buildModel: () => this.llm.getChatModel(),
        tools: this.tools.getAll(),
        checkpointer: this.checkpointer.saver,
      });
      this.logger.log('Agent graph compiled.');
    }
    return this.graph;
  }

  /**
   * Stream a single agent turn. Yields LangGraph stream events in
   * `streamMode: ["messages", "updates"]` shape so the controller can adapt
   * them into Vercel AI SDK UI message chunks.
   *
   * The optional `signal` is forwarded into the LangGraph runnable
   * config so client disconnects / explicit `useChat.stop()` actually
   * cancel the in-flight LLM + tool calls instead of letting them run
   * to completion and burn tokens.
   */
  async *streamRun(
    threadId: string,
    userMessage: string,
    signal?: AbortSignal,
  ): AsyncGenerator<{ mode: 'messages' | 'updates'; payload: unknown }> {
    const graph = this.getGraph();
    const stream = await graph.stream(
      { messages: [new HumanMessage(userMessage)] },
      {
        configurable: { thread_id: threadId },
        streamMode: ['messages', 'updates'],
        signal,
      },
    );

    for await (const chunk of stream) {
      // streamMode array → tuples of [mode, payload]
      const tuple = chunk as unknown as ['messages' | 'updates', unknown];
      const [mode, payload] = tuple;
      yield { mode, payload };
    }
  }

  /** Latest persisted messages for a thread (full, unpaginated). */
  async getMessages(threadId: string): Promise<BaseMessage[]> {
    const graph = this.getGraph();
    const snap = await graph.getState({
      configurable: { thread_id: threadId },
    });
    const values = snap.values as { messages?: BaseMessage[] } | undefined;
    return values?.messages ?? [];
  }
}
