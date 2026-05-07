import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface QdrantPoint {
  id: string | number;
  payload?: Record<string, unknown>;
  score?: number;
}

interface QueryResponse {
  result: { points: QdrantPoint[] };
}

interface ScrollResponse {
  result: { points: QdrantPoint[]; next_page_offset?: unknown };
}

interface CountResponse {
  result: { count: number };
}

/**
 * Single condition in a Qdrant filter — exact match, range, or array
 * membership against a payload field. We model only what the agent tools
 * actually use; complex (geo, has_id, nested) filters are out of scope.
 */
export type QdrantCondition =
  | { key: string; match: { value: string | number | boolean } }
  | { key: string; match: { any: Array<string | number | boolean> } }
  | {
      key: string;
      range: { gte?: number; lte?: number; gt?: number; lt?: number };
    };

export interface QdrantFilter {
  must?: QdrantCondition[];
  must_not?: QdrantCondition[];
  should?: QdrantCondition[];
}

/**
 * Two non-negotiable filter conditions baked into every search:
 *   - critic_label = "correct"   → only LLM-graded correct answers
 *   - under_gate   = false       → exclude flagged/quarantined items
 *
 * Exposed so callers can compose with the agent's optional filters via
 * {@link mergeFilter} without re-typing them and so the rules stay in one
 * place if they ever change.
 */
export const MANDATORY_FILTER: QdrantFilter = {
  must: [
    { key: 'critic_label', match: { value: 'correct' } },
    { key: 'under_gate', match: { value: false } },
  ],
};

/**
 * Append the user-supplied filter onto the mandatory filter without
 * letting the caller drop or relax the mandatory clauses.
 */
export function mergeFilter(extra?: QdrantFilter): QdrantFilter {
  if (!extra) {
    return {
      must: MANDATORY_FILTER.must ? [...MANDATORY_FILTER.must] : [],
    };
  }
  return {
    must: [...(MANDATORY_FILTER.must ?? []), ...(extra.must ?? [])],
    must_not: extra.must_not,
    should: extra.should,
  };
}

/**
 * Qdrant REST client using plain fetch.
 *
 * The official @qdrant/js-client-rest package ships ESM-only `.d.ts` files
 * which don't import cleanly under TS `module: node16` + `commonjs`-mode
 * NestJS — and we only need a small slice of the surface, so calling the
 * REST API directly keeps the dependency surface small and the build clean.
 *
 * Targets the NIM-stack collection schema (named `dense` vector, 1024
 * dims, cosine distance). Every read goes through {@link mergeFilter} so
 * the `critic_label='correct'` + `under_gate=false` invariants can't be
 * forgotten downstream.
 *
 * Defers connection until first use so the backend can boot when
 * QDRANT_URL points at a dead cluster.
 */
@Injectable()
export class QdrantClientProvider implements OnModuleInit {
  private readonly logger = new Logger(QdrantClientProvider.name);
  private baseUrl?: string;
  private apiKey?: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.get<string>('QDRANT_URL');
    if (!url) {
      this.logger.warn(
        'QDRANT_URL not set — search/find/get tools will return a ' +
          'configuration error if invoked.',
      );
      return;
    }
    this.baseUrl = url.replace(/\/+$/, '');
    this.apiKey = this.config.get<string>('QDRANT_API_KEY');
  }

  get collectionName(): string {
    return (
      this.config.get<string>('QDRANT_COLLECTION') ??
      this.config.get<string>('QDRANT_COLLECTION_NAME') ??
      'bac_qa_pairs_nim_v1'
    );
  }

  get denseVectorName(): string {
    return this.config.get<string>('QDRANT_DENSE_VECTOR_NAME') ?? 'dense';
  }

  /**
   * Dense-vector similarity search against the named `dense` vector with
   * mandatory + optional filter composition.
   */
  async searchDense(opts: {
    vector: number[];
    limit: number;
    filter?: QdrantFilter;
  }): Promise<QdrantPoint[]> {
    const data = await this.post<QueryResponse>(
      `/collections/${this.collectionName}/points/query`,
      {
        query: opts.vector,
        using: this.denseVectorName,
        limit: opts.limit,
        with_payload: true,
        filter: mergeFilter(opts.filter),
      },
    );
    return data.result?.points ?? [];
  }

  /**
   * Vector neighbours of an existing point — Qdrant's universal `/query`
   * API accepts `query: <id>` to mean "use the existing point's named
   * vector as the query vector". Returns the seed point itself first;
   * callers should drop it before showing results.
   */
  async findSimilarById(opts: {
    pointId: string | number;
    limit: number;
    filter?: QdrantFilter;
  }): Promise<QdrantPoint[]> {
    const data = await this.post<QueryResponse>(
      `/collections/${this.collectionName}/points/query`,
      {
        query: opts.pointId,
        using: this.denseVectorName,
        limit: opts.limit,
        with_payload: true,
        filter: mergeFilter(opts.filter),
      },
    );
    return data.result?.points ?? [];
  }

  /**
   * Scroll the collection by a payload filter (used for exact-match
   * lookups by `pair_id` and similar payload-keyed retrievals).
   */
  async scrollByFilter(opts: {
    filter: QdrantFilter;
    limit?: number;
  }): Promise<QdrantPoint[]> {
    const data = await this.post<ScrollResponse>(
      `/collections/${this.collectionName}/points/scroll`,
      {
        filter: mergeFilter(opts.filter),
        limit: opts.limit ?? 1,
        with_payload: true,
        with_vector: false,
      },
    );
    return data.result?.points ?? [];
  }

  /**
   * Convenience: lookup a single pair by its `pair_id` payload key.
   * Returns null when no matching point exists in the collection.
   */
  async getByPairId(pairId: string): Promise<QdrantPoint | null> {
    const points = await this.scrollByFilter({
      filter: {
        must: [{ key: 'pair_id', match: { value: pairId } }],
      },
      limit: 1,
    });
    return points[0] ?? null;
  }

  /**
   * Counts points matching mandatory + optional filters. Used by the
   * `count_questions` tool so the agent can answer "how many ... do you
   * have?" without paying embedding/rerank costs.
   */
  async count(filter?: QdrantFilter): Promise<number> {
    const data = await this.post<CountResponse>(
      `/collections/${this.collectionName}/points/count`,
      {
        filter: mergeFilter(filter),
        exact: true,
      },
    );
    return data.result?.count ?? 0;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    if (!this.baseUrl) {
      throw new Error(
        'Qdrant is not configured (set QDRANT_URL and QDRANT_API_KEY).',
      );
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['api-key'] = this.apiKey;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Qdrant ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }
}
