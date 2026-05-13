import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

/**
 * Build a `ConfigService` stand-in backed by a plain object so individual
 * test cases can declare exactly the env vars that should be visible to
 * `LlmService.constructor` and `LlmService.buildNvidia`.
 *
 * `ConfigService.get` is typed as a generic, so casting via `unknown` is
 * the cleanest way to get a typed test double without pulling in
 * `@nestjs/testing` for what is otherwise a unit test of a tiny factory.
 */
function makeConfig(env: Record<string, string>): ConfigService {
  return {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
}

describe('LlmService — provider construction', () => {
  it('builds NVIDIA chat model pointing at the configured base URL', () => {
    const service = new LlmService(
      makeConfig({
        MODEL_PROVIDER: 'nvidia',
        NVIDIA_API_KEY: 'k',
        NVIDIA_BASE_URL: 'https://integrate.api.nvidia.com/v1',
        NVIDIA_MODEL_NAME: 'meta/llama-3.3-70b-instruct',
      }),
    );
    const model = service.getChatModel() as unknown as {
      model: string;
      modelKwargs?: Record<string, unknown>;
    };
    expect(model.model).toBe('meta/llama-3.3-70b-instruct');
    // No xiaomi-specific kwargs when the base URL is the default
    // NIM endpoint — the thinking-mode workaround is scoped to MiMo.
    expect(model.modelKwargs?.chat_template_kwargs).toBeUndefined();
  });

  it('injects chat_template_kwargs.enable_thinking=false when NVIDIA_BASE_URL points at Xiaomi MiMo', () => {
    // Regression: MiMo's "thinking mode" is on by default. Each
    // completion emits a `reasoning_content` field, and the server
    // enforces that subsequent assistant messages echo the same
    // `reasoning_content` back. The default LangChain converter drops
    // that field, so the next tool-using turn 400s with:
    //
    //   "The reasoning_content in the thinking mode must be passed
    //    back to the API."
    //
    // Until we wire a proper round-trip, we disable thinking mode on
    // the MiMo endpoint via `chat_template_kwargs.enable_thinking=false`
    // (a vendor-specific kwarg that the OpenAI-compatible MiMo server
    // recognises). This unit test pins the workaround so a refactor
    // that drops the URL sniff doesn't silently regress chat after
    // the first tool call.
    const service = new LlmService(
      makeConfig({
        MODEL_PROVIDER: 'nvidia',
        NVIDIA_API_KEY: 'k',
        NVIDIA_BASE_URL: 'https://token-plan-sgp.xiaomimimo.com/v1',
        NVIDIA_MODEL_NAME: 'mimo-v2.5-pro',
      }),
    );
    const model = service.getChatModel() as unknown as {
      model: string;
      modelKwargs: { chat_template_kwargs?: { enable_thinking?: boolean } };
    };
    expect(model.model).toBe('mimo-v2.5-pro');
    expect(model.modelKwargs.chat_template_kwargs).toEqual({
      enable_thinking: false,
    });
  });

  it('caches the chat model across repeated getChatModel() calls', () => {
    // The chat node calls `buildModel()` once per ReAct iteration —
    // for a typical SVT figure-citation turn that is 2–4×. Constructing
    // a fresh OpenAI SDK client (and re-resolving env vars) per call is
    // pure overhead, so LlmService caches the instance after the first
    // build.
    const service = new LlmService(
      makeConfig({
        MODEL_PROVIDER: 'nvidia',
        NVIDIA_API_KEY: 'k',
        NVIDIA_BASE_URL: 'https://token-plan-sgp.xiaomimimo.com/v1',
        NVIDIA_MODEL_NAME: 'mimo-v2.5-pro',
      }),
    );
    expect(service.getChatModel()).toBe(service.getChatModel());
  });

  it('throws a recoverable error when MODEL_PROVIDER=nvidia but the API key is missing', () => {
    // Missing-credential errors are deliberately caught by the
    // chat-node wrapper and surfaced to the student as a generic
    // "tutor temporarily unavailable" message (see chat.node.ts).
    // Tests pin that they remain *throws* (not silent fallbacks) so
    // the wrapper can do its job.
    const service = new LlmService(makeConfig({ MODEL_PROVIDER: 'nvidia' }));
    expect(() => service.getChatModel()).toThrow(/NVIDIA_API_KEY/);
  });
});
