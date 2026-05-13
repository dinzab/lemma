import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

type Provider = 'nvidia' | 'openrouter' | 'openai';

/**
 * LlmService — central factory for the chat model used by the agent.
 *
 * Mirrors the provider switch in the Python `agent/model.py` so we can swap
 * between NVIDIA (default, OpenAI-compatible at integrate.api.nvidia.com),
 * OpenRouter, and OpenAI without touching the graph / nodes.
 */
@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private readonly provider: Provider;
  /**
   * Cached client. ChatOpenAI is a thin wrapper around an OpenAI SDK
   * client and our config doesn't change at runtime, so building one
   * per chat-node invocation (4× a turn for a typical ReAct loop) is
   * pure overhead. We construct it lazily on first use so a missing
   * credential still surfaces as a graceful AIMessage via the chat
   * node's try/catch, not a startup crash.
   */
  private model?: ChatOpenAI;

  constructor(private readonly config: ConfigService) {
    const raw = (
      this.config.get<string>('MODEL_PROVIDER') ?? 'nvidia'
    ).toLowerCase();
    if (raw === 'openrouter' || raw === 'openai' || raw === 'nvidia') {
      this.provider = raw;
    } else {
      this.provider = 'nvidia';
    }
  }

  onModuleInit(): void {
    this.logger.log(`LLM provider: ${this.provider}`);
  }

  /**
   * Return the cached ChatOpenAI instance, constructing it on first
   * use. Throws if the provider's API key is missing — surfaced as a
   * graceful AIMessage by `chat.node.ts`'s try/catch rather than
   * crashing the stream.
   */
  getChatModel(): ChatOpenAI {
    if (!this.model) {
      this.model = this.constructModel();
    }
    return this.model;
  }

  private constructModel(): ChatOpenAI {
    switch (this.provider) {
      case 'nvidia':
        return this.buildNvidia();
      case 'openrouter':
        return this.buildOpenRouter();
      case 'openai':
        return this.buildOpenAi();
    }
  }

  private buildNvidia(): ChatOpenAI {
    const apiKey =
      this.config.get<string>('NVIDIA_API_KEY') ??
      this.config.get<string>('NVIDEA_API_KEY');
    if (!apiKey) {
      throw new Error(
        'NVIDIA_API_KEY is not set. Configure it in backend/.env.local or ' +
          'switch MODEL_PROVIDER to openrouter / openai.',
      );
    }
    const baseURL =
      this.config.get<string>('NVIDIA_BASE_URL') ??
      'https://integrate.api.nvidia.com/v1';

    /**
     * Xiaomi MiMo (`token-plan-sgp.xiaomimimo.com`) defaults to *thinking
     * mode*: each completion streams a `reasoning_content` field on the
     * `choices[].delta` next to `content`, and on subsequent turns the
     * server enforces that the same `reasoning_content` is echoed back
     * inside the corresponding `assistant` message — otherwise it
     * rejects the next call with:
     *
     *   400 Param Incorrect — "The reasoning_content in the thinking
     *   mode must be passed back to the API."
     *
     * In practice this means the very first tool-using turn succeeds
     * (no prior assistant message in history), but the *second*
     * chat-node invocation — after `tool_node` appends `ToolMessage`s
     * — blows up, because @langchain/openai's
     * `convertMessagesToCompletionsMessageParams` only re-emits
     * `content` + `tool_calls` and drops
     * `additional_kwargs.reasoning_content`.
     *
     * Until we wire a proper `reasoning_content` round-trip (would
     * require either monkey-patching the converter or subclassing
     * `ChatOpenAI`), we disable MiMo's thinking mode via
     * `chat_template_kwargs.enable_thinking=false`. Internal model
     * reasoning still runs — it just isn't surfaced as a separate
     * stream so the API no longer requires the echo.
     */
    const modelKwargs: Record<string, unknown> = {};
    if (/xiaomimimo\.com/i.test(baseURL)) {
      modelKwargs.chat_template_kwargs = { enable_thinking: false };
    }

    return new ChatOpenAI({
      model:
        this.config.get<string>('NVIDIA_MODEL_NAME') ??
        'meta/llama-3.3-70b-instruct',
      apiKey,
      configuration: { baseURL },
      temperature: 0,
      streaming: true,
      ...(Object.keys(modelKwargs).length > 0 ? { modelKwargs } : {}),
    });
  }

  private buildOpenRouter(): ChatOpenAI {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not set.');
    }
    return new ChatOpenAI({
      model:
        this.config.get<string>('OPENROUTER_MODEL_NAME') ??
        'meta-llama/llama-3.3-70b-instruct',
      apiKey,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://lemma.local',
          'X-Title': 'Lemma',
        },
      },
      temperature: 0,
      streaming: true,
    });
  }

  private buildOpenAi(): ChatOpenAI {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set.');
    }
    return new ChatOpenAI({
      model: this.config.get<string>('OPENAI_MODEL_NAME') ?? 'gpt-4o-mini',
      apiKey,
      temperature: 0,
      streaming: true,
    });
  }
}
