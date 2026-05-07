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
  };

  // Constructor positional order: agent, threads, agentRuns, messages, hub.
  const service = new ChatService(
    deps.agent as never,
    deps.threads as never,
    deps.agentRuns as never,
    deps.messages as never,
    deps.hub,
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

  it('cancels the run when the client disconnects mid-stream', async () => {
    let aborted: AbortSignal | undefined;
    async function* synthetic(): AsyncGenerator<{
      mode: 'messages' | 'updates';
      payload: unknown;
    }> {
      // Force the generator to wait until aborted so we can observe the
      // cancel path. The agent.streamRun signature accepts a third
      // `signal` arg; capture it via the mock below instead.
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (aborted?.aborted)
          return reject(new DOMException('Aborted', 'AbortError'));
        aborted?.addEventListener('abort', onAbort, { once: true });
        // Safety net so the test can never hang.
        setTimeout(resolve, 2000);
      });
      yield* messageEvent(new AIMessageChunk({ id: 'never', content: 'x' }));
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

    // Let the stream open, then simulate the browser closing the tab.
    await new Promise((r) => setImmediate(r));
    emitClose();

    await promise;

    expect(deps.agentRuns.cancelRun).toHaveBeenCalledWith(
      RUN_ID,
      'Client disconnected.',
    );
    expect(deps.agentRuns.completeRun).not.toHaveBeenCalled();
    expect(deps.agentRuns.failRun).not.toHaveBeenCalled();
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
