import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * One curated thinking-frame from the Pattern Atlas, used by the A11
 * *Comment penser à ça* render block. The shape mirrors the JSON file
 * at `backend/src/content/patterns/library.json`. See product-vision
 * SKILL.md (Part E.1) for the full data shape and the rationale behind
 * "the actual moat vs. ChatGPT".
 *
 * `recipe`, `trap`, `genre`, `typical_framings`, and `variations` are
 * the visible payload — `topic_keywords` exists only to drive the
 * matcher. Matching is intentionally cheap (synchronous keyword
 * overlap) for the same reasons documented in `analogies.client.ts`.
 */
export interface Pattern {
  id: string;
  topic_label: string;
  topic_keywords: string[];
  matiere: string[];
  frequency_in_bac: number;
  genre: string;
  recipe: string[];
  trap: string;
  typical_framings: string[];
  variations: Array<{ label: string; delta: string }>;
}

interface LibraryFile {
  $schema_version: number;
  $readme?: string;
  patterns: Pattern[];
}

/**
 * Loads the curated Pattern Atlas from disk and exposes the same
 * keyword-overlap matcher as `AnalogiesClient`. Two non-obvious
 * behaviours kept on purpose:
 *
 * 1. Matching is accent- and case-insensitive. The agent emits queries
 *    in mixed FR / EN and sometimes drops accents (`forme exponentielle`
 *    vs. `forme exponentielle`); we normalise both sides before scoring.
 * 2. A `matiere` filter, when provided, is a HARD filter — we never
 *    return a math pattern for a `physique` query, even if it would
 *    match by keywords. This keeps the protocol's RECALL recipe step
 *    honest.
 *
 * The Atlas is intentionally small in this seed (~20 entries) so we
 * cover the highest-frequency BAC topics first. When it grows past
 * ~150 entries we should swap this matcher for an in-memory embedding
 * index built at boot — same plan as the Analogy Library.
 */
@Injectable()
export class PatternsClient {
  private readonly logger = new Logger(PatternsClient.name);
  private readonly patterns: Pattern[];

  /** Minimum normalised score required to count as a match. */
  private static readonly SCORE_THRESHOLD = 1;

  constructor() {
    const file = path.resolve(
      __dirname,
      '..',
      '..',
      'content',
      'patterns',
      'library.json',
    );
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as LibraryFile;
      this.patterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];
      this.logger.log(
        `Loaded ${this.patterns.length} pattern atlas entries (schema v${parsed.$schema_version}).`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to load pattern atlas at ${file}: ${String(err)}`,
      );
      this.patterns = [];
    }
  }

  /** Total number of curated patterns (useful for /healthz / debug). */
  size(): number {
    return this.patterns.length;
  }

  /**
   * Find the best-matching pattern for a free-text concept query.
   * Returns the highest-scoring pattern whose score crosses the
   * threshold, or `null` if nothing in the atlas covers the topic.
   */
  recall({
    query,
    matiere,
  }: {
    query: string;
    matiere?: string;
  }): Pattern | null {
    const normalisedQuery = normalise(query);
    if (!normalisedQuery) return null;

    const queryTokens = tokenise(normalisedQuery);
    if (queryTokens.length === 0) return null;

    let bestPattern: Pattern | null = null;
    let bestScore = 0;

    for (const pattern of this.patterns) {
      if (matiere && !pattern.matiere.includes(matiere)) continue;

      const score = scorePattern(pattern, normalisedQuery, queryTokens);
      if (score > bestScore) {
        bestScore = score;
        bestPattern = pattern;
      }
    }

    if (bestScore < PatternsClient.SCORE_THRESHOLD) return null;
    return bestPattern;
  }
}

/** Lowercase, strip accents/diacritics, collapse non-alphanumeric runs. */
function normalise(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenise(normalised: string): string[] {
  return normalised.split(/\s+/).filter((t) => t.length >= 3);
}

/**
 * Score a pattern against a normalised query. Same shape as
 * `analogies.client.ts#scoreAnchor`:
 *   - whole-keyword phrase appearing in the query (worth a lot),
 *   - topic_label phrase appearing in the query,
 *   - per-token overlap between query tokens and pattern keyword tokens.
 *
 * Scores are intentionally simple integers — debuggable, deterministic,
 * and tunable without a regression suite.
 */
function scorePattern(
  pattern: Pattern,
  normalisedQuery: string,
  queryTokens: string[],
): number {
  let score = 0;

  for (const keyword of pattern.topic_keywords) {
    const normKeyword = normalise(keyword);
    if (!normKeyword) continue;
    if (normalisedQuery.includes(normKeyword)) {
      score += 4;
    }
  }

  const normLabel = normalise(pattern.topic_label);
  if (normLabel && normalisedQuery.includes(normLabel)) {
    score += 3;
  }

  const patternTokens = new Set<string>();
  for (const keyword of pattern.topic_keywords) {
    for (const t of tokenise(normalise(keyword))) {
      patternTokens.add(t);
    }
  }
  for (const t of tokenise(normLabel)) {
    patternTokens.add(t);
  }

  for (const queryToken of queryTokens) {
    if (patternTokens.has(queryToken)) {
      score += 1;
    }
  }

  return score;
}
