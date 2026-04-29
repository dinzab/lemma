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
  result: { points: QdrantPoint[] };
}

/**
 * Qdrant REST client using plain fetch.
 *
 * The official @qdrant/js-client-rest package ships ESM-only `.d.ts` files
 * which don't import cleanly under TS `module: node16` + `commonjs`-mode
 * NestJS — and we only need two endpoints (query + scroll), so calling the
 * REST API directly keeps the dependency surface small and the build clean.
 *
 * Defers connection until first use so the backend can boot when QDRANT_URL
 * points at a dead cluster (the chat path still works; only the
 * search_vectors / get_content_by_id tools degrade).
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
        'QDRANT_URL not set — search_vectors / get_content_by_id will return ' +
          'a configuration error if invoked.',
      );
      return;
    }
    this.baseUrl = url.replace(/\/+$/, '');
    this.apiKey = this.config.get<string>('QDRANT_API_KEY');
  }

  get collectionName(): string {
    return (
      this.config.get<string>('QDRANT_COLLECTION_NAME') ??
      'bac_production_vectors'
    );
  }

  async query(opts: {
    vector: number[];
    limit: number;
  }): Promise<QdrantPoint[]> {
    const data = await this.post<QueryResponse>(
      `/collections/${this.collectionName}/points/query`,
      {
        query: opts.vector,
        limit: opts.limit,
        with_payload: true,
      },
    );
    return data.result?.points ?? [];
  }

  async scrollByDocId(docId: string): Promise<QdrantPoint | null> {
    const data = await this.post<ScrollResponse>(
      `/collections/${this.collectionName}/points/scroll`,
      {
        filter: {
          must: [{ key: 'doc_id', match: { value: docId } }],
        },
        limit: 1,
        with_payload: true,
        with_vector: false,
      },
    );
    return data.result?.points?.[0] ?? null;
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
