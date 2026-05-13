import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import {
  collectReasoning,
  getCurrentReasoningContext,
  injectReasoningIntoRequestBody,
  makeReasoningInjectingFetch,
  runWithReasoningRelay,
} from './reasoning-content-relay';

/**
 * The relay's job is end-to-end: take an AIMessage with
 * `additional_kwargs.reasoning_content` (as produced by NIM thinking
 * mode), survive a LangChain → OpenAI request body conversion that
 * drops the field, and re-attach it at the fetch boundary. We test
 * each layer independently then a small integration through the fetch
 * wrapper.
 */
describe('reasoning-content-relay', () => {
  describe('collectReasoning', () => {
    it('captures reasoning_content keyed by tool_call_id when the AIMessage has tool_calls', () => {
      const ai = new AIMessage({
        content: '',
        additional_kwargs: { reasoning_content: 'I should search for x.' },
        tool_calls: [
          {
            id: 'call_abc',
            name: 'search_questions',
            args: { query: 'x' },
            type: 'tool_call',
          },
        ],
      });
      const ctx = collectReasoning([
        new HumanMessage('hi'),
        ai,
        new ToolMessage({ content: 'result', tool_call_id: 'call_abc' }),
      ]);
      expect(ctx.byToolCallId.get('call_abc')).toBe('I should search for x.');
      // index fallback: ai is at state.messages[1] → outbound index 1+1=2
      expect(ctx.byOutboundIndex.get(2)).toBe('I should search for x.');
    });

    it('captures reasoning_content via the additional_kwargs.tool_calls back-channel', () => {
      // Some adapters stash the raw OpenAI tool_calls in
      // additional_kwargs.tool_calls instead of (or in addition to)
      // the typed `tool_calls` field. The relay must look at both.
      const ai = new AIMessage({
        content: '',
        additional_kwargs: {
          reasoning_content: 'thinking',
          tool_calls: [
            {
              id: 'call_raw',
              type: 'function',
              function: { name: 'f', arguments: '{}' },
            },
          ],
        },
      });
      const ctx = collectReasoning([ai]);
      expect(ctx.byToolCallId.get('call_raw')).toBe('thinking');
    });

    it('skips AIMessages with empty / non-string / missing reasoning_content', () => {
      const ctx = collectReasoning([
        new HumanMessage('hi'),
        new AIMessage({ content: 'a', additional_kwargs: {} }),
        new AIMessage({
          content: 'b',
          additional_kwargs: { reasoning_content: '' },
        }),
        new AIMessage({
          content: 'c',
          additional_kwargs: {
            reasoning_content: 42 as unknown as string,
          },
        }),
      ]);
      expect(ctx.byToolCallId.size).toBe(0);
      expect(ctx.byOutboundIndex.size).toBe(0);
    });

    it('ignores non-AI messages (Human, Tool)', () => {
      const ctx = collectReasoning([
        new HumanMessage('q'),
        new ToolMessage({ content: 'r', tool_call_id: 't1' }),
      ]);
      expect(ctx.byToolCallId.size).toBe(0);
      expect(ctx.byOutboundIndex.size).toBe(0);
    });

    it('applies the outbound offset so byOutboundIndex matches the request body position', () => {
      const ai = new AIMessage({
        content: '',
        additional_kwargs: { reasoning_content: 'r' },
      });
      // simulate state.messages=[user, ai] and a 2-system-message prefix
      const ctx = collectReasoning([new HumanMessage('h'), ai], 2);
      // ai is at state index 1, with offset 2 → outbound index 3
      expect(ctx.byOutboundIndex.get(3)).toBe('r');
    });
  });

  describe('injectReasoningIntoRequestBody', () => {
    it('matches by tool_call_id when the assistant message has one', () => {
      const body = {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: { name: 'f', arguments: '{}' },
              },
            ],
          },
          {
            role: 'tool',
            content: 'r',
            tool_call_id: 'call_abc',
          },
        ],
      };
      const ctx = {
        byToolCallId: new Map([['call_abc', 'I should search for x.']]),
        byOutboundIndex: new Map<number, string>(),
      };
      injectReasoningIntoRequestBody(body, ctx);
      expect(
        (body.messages[2] as { reasoning_content?: string }).reasoning_content,
      ).toBe('I should search for x.');
      // unrelated messages untouched
      expect(
        (body.messages[0] as { reasoning_content?: string }).reasoning_content,
      ).toBeUndefined();
      expect(
        (body.messages[1] as { reasoning_content?: string }).reasoning_content,
      ).toBeUndefined();
    });

    it('falls back to byOutboundIndex when no tool_call_id matches', () => {
      const body = {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'final answer' },
        ],
      };
      const ctx = {
        byToolCallId: new Map<string, string>(),
        byOutboundIndex: new Map([[2, 'reasoning text']]),
      };
      injectReasoningIntoRequestBody(body, ctx);
      expect(
        (body.messages[2] as { reasoning_content?: string }).reasoning_content,
      ).toBe('reasoning text');
    });

    it('does not clobber a reasoning_content that is already set', () => {
      const body = {
        messages: [
          {
            role: 'assistant',
            content: 'a',
            reasoning_content: 'pre-existing',
          },
        ],
      };
      const ctx = {
        byToolCallId: new Map<string, string>(),
        byOutboundIndex: new Map([[0, 'should-not-overwrite']]),
      };
      injectReasoningIntoRequestBody(body, ctx);
      expect(
        (body.messages[0] as { reasoning_content?: string }).reasoning_content,
      ).toBe('pre-existing');
    });

    it('is a no-op on bodies with no messages array', () => {
      const body = { foo: 'bar' } as unknown as { messages?: unknown[] };
      const ctx = {
        byToolCallId: new Map<string, string>(),
        byOutboundIndex: new Map<number, string>(),
      };
      expect(() => injectReasoningIntoRequestBody(body, ctx)).not.toThrow();
      expect(body).toEqual({ foo: 'bar' });
    });
  });

  describe('runWithReasoningRelay / AsyncLocalStorage', () => {
    it('exposes the context inside the callback and clears it after', async () => {
      const ctx = collectReasoning([
        new AIMessage({
          content: '',
          additional_kwargs: { reasoning_content: 'r' },
        }),
      ]);
      expect(getCurrentReasoningContext()).toBeUndefined();
      await runWithReasoningRelay(ctx, async () => {
        expect(getCurrentReasoningContext()).toBe(ctx);
      });
      expect(getCurrentReasoningContext()).toBeUndefined();
    });

    it('isolates contexts across concurrent runs', async () => {
      const ctxA = collectReasoning([
        new AIMessage({
          content: '',
          additional_kwargs: { reasoning_content: 'A' },
        }),
      ]);
      const ctxB = collectReasoning([
        new AIMessage({
          content: '',
          additional_kwargs: { reasoning_content: 'B' },
        }),
      ]);
      const seen: string[] = [];
      // default outbound offset is 1 (system prompt), so the AI at
      // state index 0 lives at outbound index 1.
      await Promise.all([
        runWithReasoningRelay(ctxA, async () => {
          await new Promise((r) => setTimeout(r, 5));
          seen.push(
            getCurrentReasoningContext()?.byOutboundIndex.get(1) ?? 'none',
          );
        }),
        runWithReasoningRelay(ctxB, async () => {
          await new Promise((r) => setTimeout(r, 1));
          seen.push(
            getCurrentReasoningContext()?.byOutboundIndex.get(1) ?? 'none',
          );
        }),
      ]);
      expect(seen.sort()).toEqual(['A', 'B']);
    });
  });

  describe('makeReasoningInjectingFetch', () => {
    it('mutates JSON bodies to add reasoning_content under the relay', async () => {
      let capturedBody: string | undefined;
      const fakeBase = async (_url: unknown, init?: { body?: unknown }) => {
        capturedBody = init?.body as string;
        return new Response('ok');
      };
      const wrapped = makeReasoningInjectingFetch(
        fakeBase as unknown as typeof globalThis.fetch,
      );
      const ai = new AIMessage({
        content: '',
        additional_kwargs: { reasoning_content: 'I should look this up.' },
        tool_calls: [
          {
            id: 'call_xyz',
            name: 'search',
            args: {},
            type: 'tool_call',
          },
        ],
      });
      const ctx = collectReasoning([new HumanMessage('q'), ai]);
      const outboundBody = JSON.stringify({
        model: 'thinking-model',
        messages: [
          { role: 'system', content: 's' },
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_xyz',
                type: 'function',
                function: { name: 'search', arguments: '{}' },
              },
            ],
          },
          { role: 'tool', content: 'r', tool_call_id: 'call_xyz' },
        ],
      });
      await runWithReasoningRelay(ctx, () =>
        wrapped('https://example/v1/chat/completions', {
          method: 'POST',
          body: outboundBody,
        }),
      );
      expect(capturedBody).toBeDefined();
      const parsed = JSON.parse(capturedBody!) as {
        messages: Array<{ role: string; reasoning_content?: string }>;
      };
      expect(parsed.messages[2].reasoning_content).toBe(
        'I should look this up.',
      );
    });

    it('passes through unchanged when no relay context is active', async () => {
      let capturedBody: string | undefined;
      const fakeBase = async (_url: unknown, init?: { body?: unknown }) => {
        capturedBody = init?.body as string;
        return new Response('ok');
      };
      const wrapped = makeReasoningInjectingFetch(
        fakeBase as unknown as typeof globalThis.fetch,
      );
      const outbound = JSON.stringify({
        messages: [{ role: 'assistant', content: 'a' }],
      });
      await wrapped('https://example/v1/chat/completions', {
        method: 'POST',
        body: outbound,
      });
      expect(capturedBody).toBe(outbound);
    });

    it('tolerates non-JSON bodies without throwing', async () => {
      let called = false;
      const fakeBase = async () => {
        called = true;
        return new Response('ok');
      };
      const wrapped = makeReasoningInjectingFetch(
        fakeBase as unknown as typeof globalThis.fetch,
      );
      const ctx = collectReasoning([
        new AIMessage({
          content: '',
          additional_kwargs: { reasoning_content: 'r' },
        }),
      ]);
      await runWithReasoningRelay(ctx, () =>
        wrapped('https://example/upload', {
          method: 'POST',
          body: 'not-json' as unknown as string,
        }),
      );
      expect(called).toBe(true);
    });

    it('tolerates non-string body (e.g. multipart, ReadableStream)', async () => {
      let capturedBody: unknown;
      const fakeBase = async (_url: unknown, init?: { body?: unknown }) => {
        capturedBody = init?.body;
        return new Response('ok');
      };
      const wrapped = makeReasoningInjectingFetch(
        fakeBase as unknown as typeof globalThis.fetch,
      );
      const ctx = collectReasoning([
        new AIMessage({
          content: '',
          additional_kwargs: { reasoning_content: 'r' },
        }),
      ]);
      const buffer = new Uint8Array([1, 2, 3]);
      await runWithReasoningRelay(ctx, () =>
        wrapped('https://example/v1/audio/speech', {
          method: 'POST',
          body: buffer as unknown as BodyInit,
        }),
      );
      expect(capturedBody).toBe(buffer);
    });
  });
});
