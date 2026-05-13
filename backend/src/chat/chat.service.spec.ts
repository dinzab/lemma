import { EventEmitter } from 'events';
import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import type { ServerResponse } from 'http';
import { ChatService } from './chat.service';
import { RunStreamHub } from '../agent-runs';
import type { AgentRunRecord } from '../agent-runs';
import type { MessageRecord } from '../messages';

/**
 * Minimal Express response stand-in for `pipeUIMessageStreamToResponse`.
 * The pipe helper only requires `setHeader`, `write`, `end`, and the
 * EventEmitter API (`on` / `off` / `emit`).
 */
function makeMockResponse(): {
  response: ServerResponse;
  bytes: () => string;
  frames: () => unknown[];
  emitClose: () => void;
} {
  const emitter = new EventEmitter();
  const chunks: Buffer[] = [];
  const headers = new Map<string, string | number | string[]>();
  let ended = false;

  let headersSent = false;
  const response = Object.assign(emitter, {
    get headersSent() {
      return headersSent;
    },
    writableEnded: false,
    statusCode: 200,
    statusMessage: 'OK',
    setHeader: (k: string, v: string | number | string[]) => {
      headers.set(k.toLowerCase(), v);
      return response;
    },
    getHeader: (k: string) => headers.get(k.toLowerCase()),
    getHeaders: () => Object.fromEntries(headers),
    hasHeader: (k: string) => headers.has(k.toLowerCase()),
    removeHeader: (k: string) => headers.delete(k.toLowerCase()),
    flushHeaders: () => undefined,
    writeHead: (
      status: number,
      statusOrHeaders?: string | Record<string, string | number | string[]>,
      maybeHeaders?: Record<string, string | number | string[]>,
    ) => {
      response.statusCode = status;
      const hdrs =
        typeof statusOrHeaders === 'object' && statusOrHeaders !== null
          ? statusOrHeaders
          : maybeHeaders;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          headers.set(k.toLowerCase(), v);
        }
      }
      headersSent = true;
      return response;
    },
    write: (chunk: string | Buffer) => {
      if (ended) return false;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end: (chunk?: string | Buffer) => {
      if (ended) return response;
      if (chunk !== undefined) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      ended = true;
      // Mirror real response semantics: emit `finish` once the body has
      // been fully written.
      setImmediate(() => emitter.emit('finish'));
      return response;
    },
  }) as unknown as ServerResponse;

  return {
    response,
    bytes: () => Buffer.concat(chunks).toString('utf8'),
    frames: () => parseSseBody(Buffer.concat(chunks).toString('utf8')),
    emitClose: () => emitter.emit('close'),
  };
}

/**
 * Parse the SSE-framed body produced by `pipeUIMessageStreamToResponse`
 * back into the JSON chunk objects the chat service emitted.
 */
function parseSseBody(body: string): unknown[] {
  const out: unknown[] = [];
  const frames = body.split(/\r?\n\r?\n/);
  for (const frame of frames) {
    const lines = frame.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data:')) {
        const v = line.slice(5);
        dataLines.push(v.startsWith(' ') ? v.slice(1) : v);
      }
    }
    const joined = dataLines.join('\n').trim();
    if (!joined) continue;
    if (joined === '[DONE]') continue;
    try {
      out.push(JSON.parse(joined));
    } catch {
      /* malformed frame */
    }
  }
  return out;
}

const RUN_ID = 'run-test';
const THREAD_ID = 'thread-test';
const USER_ID = 'user-test';

const RUN_RECORD: AgentRunRecord = {
  id: RUN_ID,
  threadId: THREAD_ID,
  userId: USER_ID,
  status: 'running',
  startedAt: new Date(),
  completedAt: null,
  error: null,
};

function makeMessageRecord(overrides: Partial<MessageRecord>): MessageRecord {
  return {
    id: overrides.id ?? `msg-${Math.random().toString(36).slice(2)}`,
    threadId: THREAD_ID,
    runId: overrides.runId ?? RUN_ID,
    userId: USER_ID,
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? '',
    reasoning: overrides.reasoning ?? '',
    toolName: overrides.toolName ?? null,
    toolCallId: overrides.toolCallId ?? null,
    toolInput: overrides.toolInput ?? null,
    toolOutput: overrides.toolOutput ?? null,
    tokenCount: overrides.tokenCount ?? null,
    sequence: overrides.sequence ?? 0,
    createdAt: overrides.createdAt ?? new Date(),
  };
}

interface MockDeps {
  agent: { streamRun: jest.Mock };
  threads: { getThread: jest.Mock };
  agentRuns: {
    startRun: jest.Mock;
    completeRun: jest.Mock;
    failRun: jest.Mock;
    cancelRun: jest.Mock;
    getRunOwnedBy: jest.Mock;
  };
  messages: {
    insertMessage: jest.Mock;
    setToolOutput: jest.Mock;
    getThreadMessages: jest.Mock;
  };
  hub: RunStreamHub;
  usage: {
    recordUsage: jest.Mock;
    checkQuota: jest.Mock;
  };
}

function buildService(events: AsyncIterable<unknown>): {
  service: ChatService;
  deps: MockDeps;
} {
  const deps: MockDeps = {
    agent: {
      streamRun: jest.fn(() => events),
    },
    threads: {
      getThread: jest.fn(async () => ({})),
    },
    agentRuns: {
      startRun: jest.fn(async () => RUN_RECORD),
      completeRun: jest.fn(async () => undefined),
      failRun: jest.fn(async () => undefined),
      cancelRun: jest.fn(async () => undefined),
      getRunOwnedBy: jest.fn(async () => RUN_RECORD),
    },
    messages: {
      insertMessage: jest.fn(async (input: { role: string }) =>
        makeMessageRecord({ role: input.role as MessageRecord['role'] }),
      ),
      setToolOutput: jest.fn(async () => undefined),
      getThreadMessages: jest.fn(async () => ({
        messages: [],
        nextCursor: null,
        total: 0,
      })),
    },
    hub: new RunStreamHub(),
    usage: {
      recordUsage: jest.fn(async () => undefined),
      checkQuota: jest.fn(async () => ({ allowed: true, remaining: 100000 })),
    },
  };

  // Constructor positional order: agent, threads, agentRuns, messages, hub, usage.
  const service = new ChatService(
    deps.agent as never,
    deps.threads as never,
    deps.agentRuns as never,
    deps.messages as never,
    deps.hub,
    deps.usage as never,
  );
  return { service, deps };
}

async function* messageEvent(
  chunk: AIMessageChunk,
): AsyncGenerator<{ mode: 'messages' | 'updates'; payload: unknown }> {
  yield { mode: 'messages', payload: [chunk, {}] };
}

describe('ChatService.streamRunToResponse', () => {
  it('streams text → tool → text and persists each segment + tool call', async () => {
    // Synthetic LangGraph stream that mirrors a real "answer with one
    // tool call" turn:
    //   1. messages-mode: AIMessageChunk with text "Hi "
    //   2. updates-mode: AIMessage with tool_calls[search] (announces input)
    //   3. updates-mode: ToolMessage with the search result
    //   4. messages-mode: AIMessageChunk with text "Done."
    async function* synthetic(): AsyncGenerator<{
      mode: 'messages' | 'updates';
      payload: unknown;
    }> {
      yield* messageEvent(new AIMessageChunk({ id: 'ai-1', content: 'Hi ' }));
      yield {
        mode: 'updates',
        payload: {
          chat_node: {
            messages: [
              new AIMessage({
                id: 'ai-2',
                content: '',
                tool_calls: [
                  {
                    id: 'tc-1',
                    name: 'search',
                    args: { query: 'foo' },
                  },
                ],
              }),
            ],
          },
        },
      };
      yield {
        mode: 'updates',
        payload: {
          tools: {
            messages: [
              {
                _getType: () => 'tool',
                tool_call_id: 'tc-1',
                content: '{"result":"42"}',
              },
            ],
          },
        },
      };
      yield* messageEvent(new AIMessageChunk({ id: 'ai-3', content: 'Done.' }));
    }

    const { service, deps } = buildService(synthetic());
    const { response, frames } = makeMockResponse();

    await service.streamRunToResponse({
      threadId: THREAD_ID,
      userId: USER_ID,
      message: 'hello',
      response,
    });

    // Wire chunks: extract just the type sequence so the test stays
    // resilient to the AI SDK adding fields (like ids) over time.
    const chunkTypes = (frames() as Array<{ type: string }>).map((c) => c.type);

    // The full expected sequence after `start … finish`:
    //   text-start → text-delta → text-end → tool-input-available →
    //   tool-output-available → text-start → text-delta → text-end → finish
    expect(chunkTypes[0]).toBe('start');
    expect(chunkTypes[chunkTypes.length - 1]).toBe('finish');
    expect(chunkTypes).toEqual(
      expect.arrayContaining([
        'text-start',
        'text-delta',
        'text-end',
        'tool-input-available',
        'tool-output-available',
      ]),
    );
    // Tool boundary: tool-input-available must come AFTER the first
    // text-end and BEFORE the second text-start. This is the inline
    // interleaving guarantee.
    const firstTextEnd = chunkTypes.indexOf('text-end');
    const toolInputIdx = chunkTypes.indexOf('tool-input-available');
    const lastTextStart = chunkTypes.lastIndexOf('text-start');
    expect(firstTextEnd).toBeGreaterThan(-1);
    expect(toolInputIdx).toBeGreaterThan(firstTextEnd);
    expect(lastTextStart).toBeGreaterThan(toolInputIdx);

    // DB writes: user message, two assistant segments, one tool call.
    const insertedRoles = deps.messages.insertMessage.mock.calls.map(
      (c) => (c[0] as { role: string }).role,
    );
    expect(insertedRoles).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(deps.messages.setToolOutput).toHaveBeenCalledTimes(1);

    // Run lifecycle: completed, never failed/cancelled.
    expect(deps.agentRuns.completeRun).toHaveBeenCalledWith(RUN_ID);
    expect(deps.agentRuns.failRun).not.toHaveBeenCalled();
    expect(deps.agentRuns.cancelRun).not.toHaveBeenCalled();
  });

  it('persists streamed reasoning as its own assistant row so reload restores the <Reasoning> collapsible', async () => {
    // Mirrors a NIM / o1-class turn: the model emits reasoning_content
    // first (chain-of-thought), then a normal text answer. The wire
    // sequence the user sees is:
    //   reasoning-start → reasoning-delta(...) → reasoning-end →
    //   text-start → text-delta → text-end → finish
    // The DB write sequence we want is:
    //   user, assistant(reasoning), assistant(text)
    async function* synthetic(): AsyncGenerator<{
      mode: 'messages' | 'updates';
      payload: unknown;
    }> {
      yield {
        mode: 'messages',
        payload: [
          new AIMessageChunk({
            id: 'ai-1',
            content: '',
            additional_kwargs: {
              reasoning_content: 'Thinking step 1. ',
            },
          }),
          {},
        ],
      };
      yield {
        mode: 'messages',
        payload: [
          new AIMessageChunk({
            id: 'ai-1',
            content: '',
            additional_kwargs: {
              reasoning_content: 'Thinking step 2.',
            },
          }),
          {},
        ],
      };
      yield* messageEvent(
        new AIMessageChunk({ id: 'ai-1', content: 'Final answer.' }),
      );
    }

    const { service, deps } = buildService(synthetic());
    const { response, frames } = makeMockResponse();

    await service.streamRunToResponse({
      threadId: THREAD_ID,
      userId: USER_ID,
      message: 'hello',
      response,
    });

    // Wire: reasoning chunks arrive before text chunks.
    const chunkTypes = (frames() as Array<{ type: string }>).map((c) => c.type);
    expect(chunkTypes).toEqual(
      expect.arrayContaining([
        'reasoning-start',
        'reasoning-delta',
        'reasoning-end',
        'text-start',
        'text-delta',
        'text-end',
      ]),
    );
    expect(chunkTypes.indexOf('reasoning-end')).toBeLessThan(
      chunkTypes.indexOf('text-start'),
    );

    // DB writes: user → assistant(reasoning row) → assistant(text row).
    // The reasoning row carries empty content + the buffered CoT in
    // `reasoning`; the text row carries the answer in `content`.
    const inserted = deps.messages.insertMessage.mock.calls.map(
      (c) =>
        c[0] as {
          role: string;
          content?: string;
          reasoning?: string;
        },
    );
    expect(inserted.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'assistant',
    ]);
    const reasoningRow = inserted[1];
    const textRow = inserted[2];
    expect(reasoningRow.reasoning).toBe('Thinking step 1. Thinking step 2.');
    expect(reasoningRow.content ?? '').toBe('');
    expect(textRow.content).toBe('Final answer.');
    expect(textRow.reasoning ?? '').toBe('');
  });

  it('keeps the run going after the client disconnects so resume can re-attach', async () => {
    // Two-phase synthetic stream: first chunk lands, then the agent
    // pauses until we explicitly let it through so we can disconnect
    // mid-flight and observe that the loop carries on.
    let resolveAgent: (() => void) | null = null;
    const agentPaused = new Promise<void>((resolve) => {
      resolveAgent = resolve;
    });
    let aborted: AbortSignal | undefined;
    async function* synthetic(): AsyncGenerator<{
      mode: 'messages' | 'updates';
      payload: unknown;
    }> {
      yield* messageEvent(
        new AIMessageChunk({ id: 'ai-1', content: 'partial ' }),
      );
      await agentPaused;
      yield* messageEvent(new AIMessageChunk({ id: 'ai-1', content: 'done.' }));
    }

    const { service, deps } = buildService(synthetic());
    deps.agent.streamRun.mockImplementation(
      (_threadId: string, _msg: string, signal?: AbortSignal) => {
        aborted = signal;
        return synthetic();
      },
    );
    const { response, emitClose } = makeMockResponse();

    const promise = service.streamRunToResponse({
      threadId: THREAD_ID,
      userId: USER_ID,
      message: 'hello',
      response,
    });

    // Let the stream open + the first chunk land, then simulate the
    // browser closing the tab. The response side unwinds; the agent
    // loop must keep running.
    await new Promise((r) => setTimeout(r, 30));
    emitClose();

    await promise;

    // Disconnect alone must not cancel the run, must not abort the
    // agent, and must not flip the lifecycle to a terminal state.
    expect(aborted?.aborted ?? false).toBe(false);
    expect(deps.agentRuns.cancelRun).not.toHaveBeenCalled();
    expect(deps.agentRuns.failRun).not.toHaveBeenCalled();
    expect(deps.agentRuns.completeRun).not.toHaveBeenCalled();

    // Now let the agent finish naturally — it should reach completion
    // even though no client is listening.
    resolveAgent?.();
    const deadline = Date.now() + 1000;
    while (
      deps.agentRuns.completeRun.mock.calls.length === 0 &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(deps.agentRuns.completeRun).toHaveBeenCalledWith(RUN_ID);
    expect(deps.agentRuns.cancelRun).not.toHaveBeenCalled();
    expect(deps.agentRuns.failRun).not.toHaveBeenCalled();
  });

  it('lets a resume subscriber re-attach to a still-running turn after disconnect', async () => {
    // Mirrors the production reload flow: client disconnects mid-stream,
    // the agent keeps running, and a fresh /chat/stream/resume request
    // re-subscribes to the hub and receives the remaining chunks.
    let resolveAgent: (() => void) | null = null;
    const agentPaused = new Promise<void>((resolve) => {
      resolveAgent = resolve;
    });
    async function* synthetic(): AsyncGenerator<{
      mode: 'messages' | 'updates';
      payload: unknown;
    }> {
      yield* messageEvent(
        new AIMessageChunk({ id: 'ai-1', content: 'before-' }),
      );
      await agentPaused;
      yield* messageEvent(
        new AIMessageChunk({ id: 'ai-1', content: 'after.' }),
      );
    }

    const { service } = buildService(synthetic());
    const first = makeMockResponse();

    const firstPromise = service.streamRunToResponse({
      threadId: THREAD_ID,
      userId: USER_ID,
      message: 'hello',
      response: first.response,
    });

    await new Promise((r) => setTimeout(r, 30));
    first.emitClose();
    await firstPromise;

    // Re-attach via resume on a fresh response — and only NOW let the
    // agent yield its remaining content. The resume subscriber must
    // receive both the replayed pre-disconnect deltas AND the live
    // post-disconnect deltas.
    const second = makeMockResponse();
    const resumePromise = service.resumeRunToResponse({
      runId: RUN_ID,
      response: second.response,
    });
    await new Promise((r) => setImmediate(r));
    resolveAgent?.();
    await resumePromise;

    const types = (second.frames() as Array<{ type: string }>).map(
      (c) => c.type,
    );
    expect(types[0]).toBe('start');
    expect(types[types.length - 1]).toBe('finish');

    const deltas = (second.frames() as Array<{ type: string; delta?: string }>)
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.delta ?? '');
    expect(deltas.join('')).toContain('before-');
    expect(deltas.join('')).toContain('after.');
  });

  it('meters only output tokens from the updates-mode AIMessage and ignores stream-chunk usage_metadata', async () => {
    // Mirrors what NVIDIA NIM / OpenAI-compatible providers emit:
    //   - several streamed AIMessageChunks each (incorrectly, for our
    //     purposes) carrying a `usage_metadata` payload that includes
    //     the huge `input_tokens` cost of the system prompt + tools
    //   - one final `updates`-mode AIMessage with the authoritative
    //     per-call usage
    // The metering must charge ONLY the final AIMessage's output_tokens
    // (200 here), never sum the streamed chunks (which would over-count
    // input + output for every chunk and explode the quota).
    async function* synthetic(): AsyncGenerator<{
      mode: 'messages' | 'updates';
      payload: unknown;
    }> {
      // Three streamed chunks. Each carries `usage_metadata` — and we
      // want it ALL ignored.
      const chunkUsage = {
        input_tokens: 16_000,
        output_tokens: 200,
        total_tokens: 16_200,
      };
      yield {
        mode: 'messages',
        payload: [
          Object.assign(new AIMessageChunk({ id: 'ai-1', content: 'Hi ' }), {
            usage_metadata: chunkUsage,
          }),
          {},
        ],
      };
      yield {
        mode: 'messages',
        payload: [
          Object.assign(new AIMessageChunk({ id: 'ai-1', content: 'there' }), {
            usage_metadata: chunkUsage,
          }),
          {},
        ],
      };
      yield {
        mode: 'messages',
        payload: [
          Object.assign(new AIMessageChunk({ id: 'ai-1', content: '.' }), {
            usage_metadata: chunkUsage,
          }),
          {},
        ],
      };
      // The finalised AIMessage from updates mode carries the
      // authoritative per-call usage. Output tokens = 200.
      yield {
        mode: 'updates',
        payload: {
          chat_node: {
            messages: [
              Object.assign(
                new AIMessage({ id: 'ai-1', content: 'Hi there.' }),
                {
                  usage_metadata: {
                    input_tokens: 16_000,
                    output_tokens: 200,
                    total_tokens: 16_200,
                  },
                },
              ),
            ],
          },
        },
      };
    }

    const { service, deps } = buildService(synthetic());
    const { response } = makeMockResponse();

    await service.streamRunToResponse({
      threadId: THREAD_ID,
      userId: USER_ID,
      message: 'Hi there',
      response,
    });

    // recordUsage runs after the stream closes (fire-and-forget). Give
    // the microtask queue a turn to flush.
    await new Promise((r) => setImmediate(r));

    expect(deps.usage.recordUsage).toHaveBeenCalledTimes(1);
    const recorded = deps.usage.recordUsage.mock.calls[0][0] as {
      tokensUsed: number;
      userId: string;
      runId: string;
      threadId: string;
    };
    // Critically: NOT 16_200 × 4 (sum across 3 chunks + final
    // AIMessage), NOT 16_200 (input + output from a single chunk),
    // but exactly 200 (output_tokens from the finalised AIMessage).
    expect(recorded.tokensUsed).toBe(200);
    expect(recorded.userId).toBe(USER_ID);
    expect(recorded.runId).toBe(RUN_ID);
    expect(recorded.threadId).toBe(THREAD_ID);
  });

  it('dedupes per AIMessage id and sums output tokens across distinct LLM calls', async () => {
    // A multi-turn ReAct loop: chat → tool → chat. Two distinct
    // LLM invocations, each with its own usage_metadata. Both
    // output_tokens counts (150 + 250) must be charged; the same
    // AIMessage id repeated in a second updates event must NOT be
    // double-counted.
    async function* synthetic(): AsyncGenerator<{
      mode: 'messages' | 'updates';
      payload: unknown;
    }> {
      // First LLM call → AIMessage with a tool_call. Output: 150.
      yield {
        mode: 'updates',
        payload: {
          chat_node: {
            messages: [
              Object.assign(
                new AIMessage({
                  id: 'ai-call-1',
                  content: '',
                  tool_calls: [
                    { id: 'tc-1', name: 'search', args: { query: 'foo' } },
                  ],
                }),
                {
                  usage_metadata: {
                    input_tokens: 16_000,
                    output_tokens: 150,
                    total_tokens: 16_150,
                  },
                },
              ),
            ],
          },
        },
      };
      // Same AIMessage re-emitted (e.g., from a downstream node that
      // forwards state) — must be deduped on `id`.
      yield {
        mode: 'updates',
        payload: {
          forwarding_node: {
            messages: [
              Object.assign(
                new AIMessage({
                  id: 'ai-call-1',
                  content: '',
                  tool_calls: [
                    { id: 'tc-1', name: 'search', args: { query: 'foo' } },
                  ],
                }),
                {
                  usage_metadata: {
                    input_tokens: 16_000,
                    output_tokens: 150,
                    total_tokens: 16_150,
                  },
                },
              ),
            ],
          },
        },
      };
      // Tool result.
      yield {
        mode: 'updates',
        payload: {
          tools: {
            messages: [
              {
                _getType: () => 'tool',
                tool_call_id: 'tc-1',
                content: '{"result":"42"}',
              },
            ],
          },
        },
      };
      // Second LLM call → final answer. Output: 250.
      yield {
        mode: 'updates',
        payload: {
          chat_node: {
            messages: [
              Object.assign(
                new AIMessage({ id: 'ai-call-2', content: 'Done.' }),
                {
                  usage_metadata: {
                    input_tokens: 16_500,
                    output_tokens: 250,
                    total_tokens: 16_750,
                  },
                },
              ),
            ],
          },
        },
      };
    }

    const { service, deps } = buildService(synthetic());
    const { response } = makeMockResponse();

    await service.streamRunToResponse({
      threadId: THREAD_ID,
      userId: USER_ID,
      message: 'do the thing',
      response,
    });

    await new Promise((r) => setImmediate(r));

    expect(deps.usage.recordUsage).toHaveBeenCalledTimes(1);
    const recorded = deps.usage.recordUsage.mock.calls[0][0] as {
      tokensUsed: number;
    };
    // 150 (first call) + 250 (second call) = 400. NOT 550 (which
    // would mean the duplicate ai-call-1 event was counted twice).
    expect(recorded.tokensUsed).toBe(400);
  });

  it('mirrors every wire chunk into RunStreamHub for resume', async () => {
    async function* synthetic(): AsyncGenerator<{
      mode: 'messages' | 'updates';
      payload: unknown;
    }> {
      yield* messageEvent(new AIMessageChunk({ id: 'ai-1', content: 'hello' }));
    }

    const { service, deps } = buildService(synthetic());
    const { response, frames } = makeMockResponse();

    await service.streamRunToResponse({
      threadId: THREAD_ID,
      userId: USER_ID,
      message: 'hi',
      response,
    });

    // Replay the hub buffer for the same run id; it must contain the
    // same start … finish envelope the wire produced.
    const replayed: Array<{ type?: string }> = [];
    for await (const event of deps.hub.subscribe(RUN_ID)) {
      if (event.kind === 'chunk') {
        replayed.push(event.chunk as { type?: string });
      } else {
        break;
      }
    }

    const wireTypes = (frames() as Array<{ type: string }>).map((c) => c.type);
    const hubTypes = replayed.map((c) => c.type);
    expect(hubTypes).toEqual(wireTypes);
    expect(hubTypes[0]).toBe('start');
    expect(hubTypes[hubTypes.length - 1]).toBe('finish');
  });
});

describe('ChatService.resumeRunToResponse', () => {
  it('replays buffered chunks for an in-flight run', async () => {
    const { service, deps } = buildService(
      (async function* () {})() as AsyncIterable<unknown>,
    );
    deps.hub.publish(RUN_ID, { type: 'start' });
    deps.hub.publish(RUN_ID, { type: 'text-start', id: 't1' });
    deps.hub.publish(RUN_ID, {
      type: 'text-delta',
      id: 't1',
      delta: 'partial',
    });
    deps.hub.publish(RUN_ID, { type: 'text-end', id: 't1' });
    deps.hub.publish(RUN_ID, { type: 'finish' });
    deps.hub.close(RUN_ID, 'completed');

    const { response, frames } = makeMockResponse();
    await service.resumeRunToResponse({ runId: RUN_ID, response });

    const types = (frames() as Array<{ type: string }>).map((c) => c.type);
    expect(types).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ]);
  });

  it('synthesises a start … finish envelope when the run is no longer in memory', async () => {
    const { service } = buildService(
      (async function* () {})() as AsyncIterable<unknown>,
    );
    const { response, frames } = makeMockResponse();
    await service.resumeRunToResponse({ runId: 'unknown', response });

    const types = (frames() as Array<{ type: string }>).map((c) => c.type);
    expect(types).toEqual(['start', 'finish']);
  });
});
