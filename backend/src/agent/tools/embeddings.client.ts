import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * OpenRouter-backed embedding client used by `search_vectors`.
 *
 * Mirrors the Python `embed_query` in `agent/config.py`. Uses
 * `paraphrase-minilm-l6-v2` (384 dims) by default to match the existing
 * Qdrant collection's vector size — changing the model means re-indexing.
 */
@Injectable()
export class EmbeddingsClient {
  private readonly logger = new Logger(EmbeddingsClient.name);

  constructor(private readonly config: ConfigService) {}

  async embed(query: string): Promise<number[]> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new Error(
        'OPENROUTER_API_KEY is not set — required for embeddings even when ' +
          'the chat model is on a different provider.',
      );
    }
    const model =
      this.config.get<string>('EMBEDDING_MODEL') ??
      'sentence-transformers/paraphrase-minilm-l6-v2';

    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://lemma.local',
        'X-Title': 'Lemma',
      },
      body: JSON.stringify({
        model,
        input: query,
        encoding_format: 'float',
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Embedding request failed: ${res.status} ${res.statusText} ${body}`,
      );
    }

    const data = (await res.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error('Embedding response missing data[0].embedding');
    }
    return embedding;
  }
}
