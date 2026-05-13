import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { makeReasoningInjectingFetch } from './reasoning-content-relay';

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
    return new ChatOpenAI({
      model:
        this.config.get<string>('NVIDIA_MODEL_NAME') ??
        'meta/llama-3.3-70b-instruct',
      apiKey,
      configuration: {
        baseURL:
          this.config.get<string>('NVIDIA_BASE_URL') ??
          'https://integrate.api.nvidia.com/v1',
        // NIM's reasoning ("thinking") models 400 with
        // 'reasoning_content in the thinking mode must be passed back'
        // on the second hop of a ReAct loop unless the field they
        // emitted on the first hop is echoed back to them. LangChain's
        // OpenAI converter drops `additional_kwargs.reasoning_content`,
        // so we re-attach it at the fetch boundary using the
        // request-scoped relay populated by chat.node.
        fetch: makeReasoningInjectingFetch(),
      },
      temperature: 0,
      streaming: true,
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
        // OpenRouter proxies a number of reasoning models that share
        // NIM's `reasoning_content` round-trip contract. The injector
        // is a no-op when the relay context is unset (i.e. for
        // non-chat-node callers), so installing it unconditionally is
        // safe.
        fetch: makeReasoningInjectingFetch(),
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
      configuration: {
        // Stock OpenAI doesn't currently emit `reasoning_content` for
        // chat models, but the injector is a no-op outside the relay
        // context and tolerates any body shape — install it here too
        // for consistency with the NVIDIA / OpenRouter paths.
        fetch: makeReasoningInjectingFetch(),
      },
      temperature: 0,
      streaming: true,
    });
  }
}
