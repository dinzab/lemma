import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import type { FigureAnalysis, FigureFocus } from './vision.service';

export interface CacheKey {
  /** Storage-key relpath of the figure (`<exam_stem>/figures/<id>.png`). */
  relpath: string;
  focus: FigureFocus;
  /** Caller question, normalised so trivial whitespace differences hit the same row. */
  question?: string;
}

export interface CachedAnalysis {
  analysis: FigureAnalysis;
  model: string;
  cachedAt: Date;
}

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS lemma_figure_perception_cache (
  relpath        TEXT        NOT NULL,
  focus          TEXT        NOT NULL,
  question_hash  TEXT        NOT NULL,
  payload        JSONB       NOT NULL,
  model          TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (relpath, focus, question_hash)
);
`;

const SELECT_SQL = `
SELECT payload, model, created_at
  FROM lemma_figure_perception_cache
 WHERE relpath = $1 AND focus = $2 AND question_hash = $3
 LIMIT 1;
`;

const UPSERT_SQL = `
INSERT INTO lemma_figure_perception_cache (relpath, focus, question_hash, payload, model)
VALUES ($1, $2, $3, $4::jsonb, $5)
ON CONFLICT (relpath, focus, question_hash)
DO UPDATE SET payload = EXCLUDED.payload, model = EXCLUDED.model, created_at = NOW();
`;

const MEMORY_LRU_CAPACITY = 500;

/**
 * Memoised store for vision-LLM figure analyses.
 *
 * Why we cache:
 *   The vision API costs ~5–10× a text token (and adds ~1–3s latency).
 *   Most figure questions in this corpus repeat ("what's the topology
 *   of figure 2 of pair X" gets asked across many sessions). Caching
 *   on `(relpath, focus, normalised_question)` makes repeated calls
 *   O(1).
 *
 * Storage:
 *   - Postgres-backed when `POSTGRES_URI` is configured (production).
 *     Survives restarts; shared across replicas. Schema is a single
 *     `lemma_figure_perception_cache` table created idempotently on
 *     boot.
 *   - In-memory LRU fallback when no Postgres is configured (dev / unit
 *     tests). Capped at 500 entries to bound RAM.
 *
 * The in-memory fallback exists primarily so tests + local dev still
 * exercise the cache code paths. Production should always run with
 * Postgres so the cache is persistent and shared.
 */
@Injectable()
export class FigurePerceptionCacheService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(FigurePerceptionCacheService.name);
  private pool?: Pool;
  /** Used when no Postgres is configured. Insertion-ordered so we can evict oldest. */
  private readonly memory = new Map<string, CachedAnalysis>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const uri = this.config.get<string>('POSTGRES_URI');
    if (!uri) {
      this.logger.warn(
        'POSTGRES_URI not set — figure perception cache will use an ' +
          'in-memory LRU. Cache will not persist across restarts.',
      );
      return;
    }
    try {
      this.pool = new Pool({ connectionString: uri, max: 4 });
      await this.pool.query(CREATE_TABLE_SQL);
      this.logger.log(
        'Figure perception cache ready (Postgres lemma_figure_perception_cache).',
      );
    } catch (err) {
      this.logger.warn(
        `Postgres init for figure perception cache failed: ${
          (err as Error).message
        }. Falling back to in-memory LRU.`,
      );
      try {
        await this.pool?.end();
      } catch {
        // ignore — pool may already be in a bad state
      }
      this.pool = undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.end();
      } catch (err) {
        this.logger.warn(
          `Error closing figure perception cache pool: ${String(err)}`,
        );
      }
    }
  }

  async get(key: CacheKey): Promise<CachedAnalysis | null> {
    const composite = this.compositeKey(key);
    if (!this.pool) {
      return this.memory.get(composite) ?? null;
    }
    try {
      const res = await this.pool.query<{
        payload: FigureAnalysis | string;
        model: string;
        created_at: Date;
      }>(SELECT_SQL, [key.relpath, key.focus, this.questionHash(key.question)]);
      const row = res.rows[0];
      if (!row) return null;
      // pg drivers may serialize JSONB as a string when column type
      // metadata is missing for the prepared statement; tolerate both.
      const payload =
        typeof row.payload === 'string'
          ? (JSON.parse(row.payload) as FigureAnalysis)
          : row.payload;
      return { analysis: payload, model: row.model, cachedAt: row.created_at };
    } catch (err) {
      this.logger.warn(
        `Cache lookup failed (relpath=${key.relpath}): ${
          (err as Error).message
        }`,
      );
      return null;
    }
  }

  async put(
    key: CacheKey,
    analysis: FigureAnalysis,
    model: string,
  ): Promise<void> {
    const composite = this.compositeKey(key);
    if (!this.pool) {
      // LRU: re-insert at the tail, evict head if over capacity.
      this.memory.delete(composite);
      this.memory.set(composite, { analysis, model, cachedAt: new Date() });
      while (this.memory.size > MEMORY_LRU_CAPACITY) {
        const oldest = this.memory.keys().next().value;
        if (oldest === undefined) break;
        this.memory.delete(oldest);
      }
      return;
    }
    try {
      await this.pool.query(UPSERT_SQL, [
        key.relpath,
        key.focus,
        this.questionHash(key.question),
        JSON.stringify(analysis),
        model,
      ]);
    } catch (err) {
      this.logger.warn(
        `Cache upsert failed (relpath=${key.relpath}): ${
          (err as Error).message
        }`,
      );
    }
  }

  /** Exposed for tests. */
  isPostgresMode(): boolean {
    return !!this.pool;
  }

  /** Normalise free-form questions so trivial whitespace differences hit the same row. */
  private questionHash(question?: string): string {
    const normalised = (question ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    return createHash('sha1').update(normalised).digest('hex').slice(0, 16);
  }

  private compositeKey(key: CacheKey): string {
    return `${key.relpath}::${key.focus}::${this.questionHash(key.question)}`;
  }
}
