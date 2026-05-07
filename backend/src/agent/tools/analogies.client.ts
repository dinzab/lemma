import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Curated Tunisian-BAC real-life anchor used by the A12 *Dans la vraie
 * vie* render block. The shape mirrors the JSON file at
 * `backend/src/content/analogies/library.json`. See product-vision
 * SKILL.md (Part E.3) for the rationale behind the moat.
 */
export interface Anchor {
  id: string;
  concept_label: string;
  concept_keywords: string[];
  matiere: string[];
  label: string;
  short: string;
  full: string;
  language: string;
  tags: string[];
}

interface LibraryFile {
  $schema_version: number;
  $readme?: string;
  anchors: Anchor[];
}

/**
 * Loads the curated analogy library from disk and exposes a small
 * keyword-overlap matcher. Phase 1 deliberately uses a cheap synchronous
 * scoring function instead of embeddings — the library is small (~50
 * entries), the agent only needs the best anchor or "no match", and we
 * want zero extra latency / cost on every chat turn. When the library
 * grows past ~150 entries we should swap this for a small in-memory
 * embedding index built at boot.
 *
 * Two non-obvious behaviours worth keeping if you refactor:
 *
 * 1. Matching is accent- and case-insensitive. The agent emits queries
 *    in mixed FR / EN and sometimes drops accents (`fonction affine` vs
 *    `fonction affine`); we normalise both sides before scoring.
 * 2. A `matiere` filter, when provided, is a HARD filter — we never
 *    return a math anchor for a `physique` query, even if it would match
 *    by keywords. This keeps the protocol's RECALL anchor step honest.
 */
@Injectable()
export class AnalogiesClient {
  private readonly logger = new Logger(AnalogiesClient.name);
  private readonly anchors: Anchor[];

  /** Minimum normalised score required to count as a match. */
  private static readonly SCORE_THRESHOLD = 1;

  constructor() {
    const file = path.resolve(
      __dirname,
      '..',
      '..',
      'content',
      'analogies',
      'library.json',
    );
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as LibraryFile;
      this.anchors = Array.isArray(parsed.anchors) ? parsed.anchors : [];
      this.logger.log(
        `Loaded ${this.anchors.length} analogy anchors (schema v${parsed.$schema_version}).`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to load analogy library at ${file}: ${String(err)}`,
      );
      this.anchors = [];
    }
  }

  /** Total number of curated anchors (useful for /healthz / debug). */
  size(): number {
    return this.anchors.length;
  }

  /**
   * Find the best-matching anchor for a free-text concept query.
   * Returns the highest-scoring anchor whose score crosses the
   * threshold, or `null` if nothing in the library covers the topic.
   */
  recall({
    query,
    matiere,
  }: {
    query: string;
    matiere?: string;
  }): Anchor | null {
    const normalisedQuery = normalise(query);
    if (!normalisedQuery) return null;

    const queryTokens = tokenise(normalisedQuery);
    if (queryTokens.length === 0) return null;

    let bestAnchor: Anchor | null = null;
    let bestScore = 0;

    for (const anchor of this.anchors) {
      if (matiere && !anchor.matiere.includes(matiere)) continue;

      const score = scoreAnchor(anchor, normalisedQuery, queryTokens);
      if (score > bestScore) {
        bestScore = score;
        bestAnchor = anchor;
      }
    }

    if (bestScore < AnalogiesClient.SCORE_THRESHOLD) return null;
    return bestAnchor;
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
 * Score an anchor against a normalised query. We reward, in order:
 *   - whole-keyword phrase appearing in the query (worth a lot, because
 *     `fonction affine` matching is much stronger than the words being
 *     scattered across the query),
 *   - concept_label phrase appearing in the query,
 *   - per-token overlap between query tokens and anchor keyword tokens.
 *
 * Scores are intentionally simple integers — debuggable, deterministic,
 * and tunable without a regression suite.
 */
function scoreAnchor(
  anchor: Anchor,
  normalisedQuery: string,
  queryTokens: string[],
): number {
  let score = 0;

  for (const keyword of anchor.concept_keywords) {
    const normKeyword = normalise(keyword);
    if (!normKeyword) continue;
    if (normalisedQuery.includes(normKeyword)) {
      // Phrase match worth more than scattered token overlap.
      score += 4;
    }
  }

  const normLabel = normalise(anchor.concept_label);
  if (normLabel && normalisedQuery.includes(normLabel)) {
    score += 3;
  }

  const anchorTokens = new Set<string>();
  for (const keyword of anchor.concept_keywords) {
    for (const t of tokenise(normalise(keyword))) {
      anchorTokens.add(t);
    }
  }
  for (const t of tokenise(normLabel)) {
    anchorTokens.add(t);
  }

  for (const queryToken of queryTokens) {
    if (anchorTokens.has(queryToken)) {
      score += 1;
    }
  }

  return score;
}
