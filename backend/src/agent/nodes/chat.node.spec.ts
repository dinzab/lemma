import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { __testing, makeChatNode } from './chat.node';
import { getCurrentReasoningContext } from '../reasoning-content-relay';

const { describeLlmError } = __testing;

describe('describeLlmError', () => {
  it('returns String(exc) for non-object errors', () => {
    expect(describeLlmError('boom')).toBe('boom');
    expect(describeLlmError(42)).toBe('42');
    expect(describeLlmError(null)).toBe('null');
    expect(describeLlmError(undefined)).toBe('undefined');
  });

  it('returns String(exc) for shapes without a numeric `status` (plain Error, AbortError, …)', () => {
    const plain = new Error('socket hang up');
    expect(describeLlmError(plain)).toBe('Error: socket hang up');
  });

  it('extracts the diagnostic surface of an OpenAI-SDK APIError on a 400 (NIM "Param Incorrect")', () => {
    // Mirrors how `openai/core/error.js` populates a BadRequestError:
    // - top-level `status` / `name` / `message`
    // - `error` = the upstream provider's full `error` body
    // - `code` / `param` / `type` pulled out of that body
    const apiError = Object.assign(new Error('400 Param Incorrect'), {
      name: 'BadRequestError',
      status: 400,
      code: 'invalid_request_error',
      type: 'BadRequestError',
      param: 'messages.2.tool_calls.0.function.arguments',
      requestID: 'req_abc123',
      error: {
        message: 'Param Incorrect',
        code: 'invalid_request_error',
        type: 'BadRequestError',
        param: 'messages.2.tool_calls.0.function.arguments',
      },
    });

    const line = describeLlmError(apiError);

    // The crucial pieces — NIM's generic `"Param Incorrect"` is useless on
    // its own, so we want `param`, `code`, and the full `error` body for
    // triage.
    expect(line).toContain('status=400');
    expect(line).toContain('name=BadRequestError');
    expect(line).toContain('code=invalid_request_error');
    expect(line).toContain('type=BadRequestError');
    expect(line).toContain('param=messages.2.tool_calls.0.function.arguments');
    expect(line).toContain('requestID=req_abc123');
    expect(line).toContain('message=400 Param Incorrect');
    expect(line).toContain('"message":"Param Incorrect"');
  });

  it('caps a huge `error` body so a single failure cannot blow up log volume', () => {
    // Some providers (incl. NVIDIA's) echo the offending request fragment
    // back into the error body. With multi-result `search_questions`
    // payloads in the message history that fragment can be several KB.
    const giantBody = 'x'.repeat(5000);
    const apiError = Object.assign(new Error('400 Bad Request'), {
      status: 400,
      error: { message: giantBody },
    });

    const line = describeLlmError(apiError);

    expect(line).toContain('…(truncated)');
    // The truncated marker must follow the capped slice, NOT the full body.
    expect(line.length).toBeLessThan(giantBody.length + 200);
  });

  it('handles missing optional fields without serialising "undefined"', () => {
    const apiError = Object.assign(new Error('502 Bad Gateway'), {
      status: 502,
    });

    const line = describeLlmError(apiError);

    expect(line).toBe('status=502 name=Error message=502 Bad Gateway');
  });

  it('serialises a non-JSON-able `error` value via String() fallback', () => {
    // Defensive: should never happen with the real OpenAI SDK, but a
    // circular structure or a class instance with a thrown getter
    // shouldn't take the whole chat node down.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const apiError = Object.assign(new Error('400 Bad Request'), {
      status: 400,
      error: circular,
    });

    expect(() => describeLlmError(apiError)).not.toThrow();
  });
});

describe('makeChatNode reasoning_content relay wiring', () => {
  /**
   * Build a `ChatOpenAI`-shaped mock just rich enough for `makeChatNode`
   * to exercise. We don't need the real model; we just need
   * `bindTools(…).invoke([…])` to be callable and to expose what the
   * relay context looks like *at invoke time*. That's enough to verify
   * the chat node:
   *   (a) collects reasoning_content from `state.messages`, and
   *   (b) attaches it to the AsyncLocalStorage before calling invoke().
   */
  function makeFakeModel(
    onInvoke: (messages: BaseMessage[]) => Promise<AIMessage>,
  ): { buildModel: () => ChatOpenAI; invokeCalls: BaseMessage[][] } {
    const invokeCalls: BaseMessage[][] = [];
    const fakeBound = {
      invoke: async (messages: BaseMessage[]) => {
        invokeCalls.push(messages);
        return onInvoke(messages);
      },
    };
    const fakeModel = {
      bindTools: () => fakeBound,
    } as unknown as ChatOpenAI;
    return { buildModel: () => fakeModel, invokeCalls };
  }

  it('populates a relay context with reasoning_content from prior AIMessages before invoking', async () => {
    let observedReasoning: string | undefined;
    const { buildModel, invokeCalls } = makeFakeModel(async () => {
      const ctx = getCurrentReasoningContext();
      observedReasoning = ctx?.byToolCallId.get('call_abc');
      return new AIMessage({ content: 'final answer' });
    });

    const chatNode = makeChatNode(buildModel, []);
    const prior = new AIMessage({
      content: '',
      additional_kwargs: {
        reasoning_content: 'I should search for past papers on x.',
      },
      tool_calls: [
        {
          id: 'call_abc',
          name: 'search_questions',
          args: { q: 'x' },
          type: 'tool_call',
        },
      ],
    });
    await chatNode({
      messages: [
        new HumanMessage('please find x'),
        prior,
        new ToolMessage({
          content: '{"hits":[]}',
          tool_call_id: 'call_abc',
        }),
      ],
    });

    expect(invokeCalls.length).toBe(1);
    // Should have prepended the system prompt
    expect(invokeCalls[0].length).toBe(4);
    expect(observedReasoning).toBe('I should search for past papers on x.');
  });

  it('still invokes the model when there is no reasoning_content to relay (no regression for non-thinking providers)', async () => {
    let ranInsideRelay = false;
    const { buildModel } = makeFakeModel(async () => {
      // Even with an empty map, the relay should still be active —
      // the fetch hook is then a no-op for messages without matches.
      const ctx = getCurrentReasoningContext();
      ranInsideRelay = ctx !== undefined && ctx.byToolCallId.size === 0;
      return new AIMessage({ content: 'hello' });
    });
    const chatNode = makeChatNode(buildModel, []);
    await chatNode({ messages: [new HumanMessage('hi')] });
    expect(ranInsideRelay).toBe(true);
  });
});
