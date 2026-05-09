import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * NVIDIA NIM-backed embedding client used to embed agent queries before
 * vector search in Qdrant.
 *
 * Calls the OpenAI-compatible NIM endpoint at
 *   ${NIM_EMBED_URL} (default: https://integrate.api.nvidia.com/v1/embeddings)
 * with `model = ${NIM_EMBED_MODEL}` (default `nvidia/llama-nemotron-embed-1b-v2`,
 * 1024 dims). The dimension is hard-coded against the existing Qdrant
 * collection — changing it means re-indexing the corpus.
 *
 * Auth: prefers the dedicated `NIM_EMBED_API_KEY` so the embedding key
 * can be rotated / scoped independently of the chat-model key. Falls
 * back to `NVIDIA_API_KEY` for backward compatibility with existing
 * deployments. This decoupling matters: swapping the chat model's
 * provider/key must not silently break embeddings (and therefore RAG).
 *
 * `input_type=query` is required by NVIDIA's embed-1b-v2 model so the
 * server-side normalisation matches the document side that was indexed
 * with `input_type=passage`. Mismatching this pair tanks recall.
 */
@Injectable()
export class EmbeddingsClient {
  private readonly logger = new Logger(EmbeddingsClient.name);

  constructor(private readonly config: ConfigService) {}

  async embed(query: string): Promise<number[]> {
    const apiKey =
      this.config.get<string>('NIM_EMBED_API_KEY') ??
      this.config.get<string>('NVIDIA_API_KEY') ??
      this.config.get<string>('NVIDEA_API_KEY');
    if (!apiKey) {
      throw new Error(
        'No NIM embed API key set — configure NIM_EMBED_API_KEY ' +
          '(preferred) or NVIDIA_API_KEY (legacy fallback).',
      );
    }

    const url =
      this.config.get<string>('NIM_EMBED_URL') ??
      'https://integrate.api.nvidia.com/v1/embeddings';
    const model =
      this.config.get<string>('NIM_EMBED_MODEL') ??
      'nvidia/llama-nemotron-embed-1b-v2';
    const rawDim = this.config.get<string>('NIM_EMBED_DIM');
    const dimensions = rawDim ? Number.parseInt(rawDim, 10) : 1024;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [query],
        input_type: 'query',
        dimensions,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `NIM embedding request failed: ${res.status} ${res.statusText} ${body}`,
      );
    }

    const data = (await res.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error('NIM embedding response missing data[0].embedding');
    }
    if (embedding.length !== dimensions) {
      this.logger.warn(
        `NIM returned embedding with ${embedding.length} dims but ` +
          `NIM_EMBED_DIM=${dimensions} expected — check model + collection alignment.`,
      );
    }
    return embedding;
  }
}
