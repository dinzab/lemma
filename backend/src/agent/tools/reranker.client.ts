import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * NVIDIA NIM reranker client. Used as the second stage of two-stage
 * retrieval: pull top-N candidates from Qdrant via dense vector search,
 * then rerank with a cross-encoder model to refine the top-K.
 *
 * Endpoint: ${NIM_RERANK_URL} (default
 * `https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking`)
 * Model: ${NIM_RERANK_MODEL} (default `nvidia/rerank-qa-mistral-4b`)
 *
 * Auth: prefers the dedicated `NIM_RERANK_API_KEY` so the reranker key
 * can be rotated / scoped independently of the chat-model key. Falls
 * back to `NVIDIA_API_KEY` for backward compatibility with existing
 * deployments. Same motivation as the embedding client: swapping the
 * chat model provider/key should not silently break reranking.
 *
 * The reranker is non-fatal — if it fails (HTTP error, model unavailable),
 * we log a warning and return the candidates in their original Qdrant
 * order. This preserves recall at the cost of a less-precise top-K, which
 * is strictly better than a hard tool failure mid-conversation.
 */
@Injectable()
export class RerankerClient {
  private readonly logger = new Logger(RerankerClient.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Rank the passages by relevance to the query. Returns a new array
   * containing the same items but ordered by reranker logit (descending).
   *
   * Items missing from the reranker response (e.g. silent truncation
   * upstream) are appended at the end in their original order so no
   * candidates are dropped.
   */
  async rerank<T>(opts: {
    query: string;
    passages: T[];
    getText: (item: T) => string;
    topK?: number;
  }): Promise<T[]> {
    if (opts.passages.length === 0) return [];

    const apiKey =
      this.config.get<string>('NIM_RERANK_API_KEY') ??
      this.config.get<string>('NVIDIA_API_KEY') ??
      this.config.get<string>('NVIDEA_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'No NIM rerank API key set (NIM_RERANK_API_KEY or NVIDIA_API_KEY) — ' +
          'skipping rerank, returning passages as-is.',
      );
      return opts.topK ? opts.passages.slice(0, opts.topK) : opts.passages;
    }

    const url =
      this.config.get<string>('NIM_RERANK_URL') ??
      'https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking';
    const model =
      this.config.get<string>('NIM_RERANK_MODEL') ??
      'nvidia/rerank-qa-mistral-4b';

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model,
          query: { text: opts.query },
          passages: opts.passages.map((p) => ({ text: opts.getText(p) })),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `NIM rerank ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
        );
        return opts.topK ? opts.passages.slice(0, opts.topK) : opts.passages;
      }
      const data = (await res.json()) as {
        rankings?: Array<{ index: number; logit: number }>;
      };
      if (!data.rankings || data.rankings.length === 0) {
        return opts.topK ? opts.passages.slice(0, opts.topK) : opts.passages;
      }

      const sorted = [...data.rankings].sort((a, b) => b.logit - a.logit);
      const seen = new Set<number>();
      const reranked: T[] = [];
      for (const r of sorted) {
        if (
          r.index >= 0 &&
          r.index < opts.passages.length &&
          !seen.has(r.index)
        ) {
          reranked.push(opts.passages[r.index]);
          seen.add(r.index);
        }
      }
      // Defensive: append any candidates the reranker silently dropped.
      for (let i = 0; i < opts.passages.length; i++) {
        if (!seen.has(i)) reranked.push(opts.passages[i]);
      }
      return opts.topK ? reranked.slice(0, opts.topK) : reranked;
    } catch (err) {
      this.logger.warn(
        `NIM rerank failed: ${(err as Error).message}. Falling back to recall order.`,
      );
      return opts.topK ? opts.passages.slice(0, opts.topK) : opts.passages;
    }
  }
}
