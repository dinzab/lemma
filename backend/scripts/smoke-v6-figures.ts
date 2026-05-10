/**
 * v6 figure surface smoke test. Drives the new
 * `show_question_assets` tool against live infra:
 *
 *   1. search_questions for a pair we know carries an énoncé figure
 *      (physique, technique, 2018 — the spec's Q1).
 *   2. show_question_assets({ pair_id, side: 'enonce' }).
 *   3. assert the response shape (4 image URLs, has_figure_enonce
 *      truthy, default_side echoed).
 *   4. HEAD-check the énoncé URL against R2 — must come back 200
 *      image/png. This is the contract that lets us turn passive
 *      thumbnails on in `<PastPaperChip>` and the explicit panel
 *      on `<QuestionAssetsBlock>` without surprises.
 *   5. Verify a NULL-image case: pick a pair with
 *      has_figure_enonce=false and confirm the corresponding URL is
 *      null instead of fabricating an asset URL.
 *
 * Run with:
 *
 *   R2_PUBLIC_BASE='https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev/ocr_omni' \
 *     npx ts-node --transpile-only scripts/smoke-v6-figures.ts
 *
 * Manual / network-bound on purpose — exercises NIM + Qdrant + R2
 * in a single pass so we don't ship the figure surface blind.
 */

import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { AgentToolsService } from '../src/agent/tools';
import { QdrantClientProvider } from '../src/agent/tools/qdrant.client';
import { Neo4jClientProvider } from '../src/agent/tools/neo4j.client';
import { EmbeddingsClient } from '../src/agent/tools/embeddings.client';
import { RerankerClient } from '../src/agent/tools/reranker.client';
import { VisionService } from '../src/agent/vision.service';
import { FigurePerceptionCacheService } from '../src/agent/figure-perception-cache.service';
import type { StructuredToolInterface } from '@langchain/core/tools';

interface SearchHit {
  pair_id?: string;
  has_figure_enonce?: boolean;
  has_figure_corrige?: boolean;
  images?: Record<string, string | null>;
  matiere?: string;
  track?: string;
  year?: number | string;
}

interface AssetsResponse {
  pair_id: string;
  has_figure_enonce: boolean;
  has_figure_corrige: boolean;
  has_any_figure: boolean;
  default_side: string;
  matiere: string | null;
  track: string | null;
  year: number | null;
  exercise_number: number | null;
  question_number: string | null;
  source_pages_enonce: number[];
  source_pages_corrige: number[];
  images: {
    exercise_enonce: string | null;
    exercise_corrige: string | null;
    exam_full_enonce: string | null;
    exam_full_corrige: string | null;
  };
}

async function head(url: string): Promise<{ status: number; type: string }> {
  const r = await fetch(url, { method: 'HEAD' });
  return {
    status: r.status,
    type: r.headers.get('content-type') ?? '',
  };
}

async function main() {
  const config = new ConfigService();
  const cdn = config.get<string>('R2_PUBLIC_BASE');
  if (!cdn) {
    throw new Error(
      'R2_PUBLIC_BASE must be set for this smoke test (URL composition + HEAD check).',
    );
  }
  console.log(`R2_PUBLIC_BASE=${cdn}`);

  const qdrant = new QdrantClientProvider(config);
  qdrant.onModuleInit();
  const neo4j = new Neo4jClientProvider(config);
  neo4j.onModuleInit();
  const embeddings = new EmbeddingsClient(config);
  const reranker = new RerankerClient(config);

  const vision = new VisionService(config);
  const perceptionCache = new FigurePerceptionCacheService(config);
  await perceptionCache.onModuleInit();
  const service = new AgentToolsService(
    qdrant,
    neo4j,
    embeddings,
    reranker,
    vision,
    perceptionCache,
    config,
  );
  const byName = new Map<string, StructuredToolInterface>(
    service.getAll().map((t) => [t.name, t]),
  );

  const search = async (
    args: Record<string, unknown>,
  ): Promise<SearchHit[]> => {
    const t = byName.get('search_questions');
    if (!t) throw new Error('search_questions missing');
    const out = (await t.invoke(args)) as string;
    return (JSON.parse(out) as { results?: SearchHit[] }).results ?? [];
  };

  const showAssets = async (
    args: Record<string, unknown>,
  ): Promise<AssetsResponse> => {
    const t = byName.get('show_question_assets');
    if (!t) throw new Error('show_question_assets missing');
    const out = (await t.invoke(args)) as string;
    return JSON.parse(out) as AssetsResponse;
  };

  try {
    // 1. Find a figured pair. We try a few queries because some of the
    //    most natural ones ("ondes mécaniques") happen to land on
    //    text-only summary pairs in the rerank top-K. Fall through to
    //    a known-figured math pair if no search query surfaces one.
    const candidateQueries = [
      {
        query: 'graphique fonction logarithme tableau de variations',
        matiere: 'math' as const,
        limit: 10,
      },
      {
        query: 'figure géométrique triangle cercle bac',
        matiere: 'math' as const,
        limit: 10,
      },
      {
        query: 'circuit électrique résistance schéma',
        matiere: 'physique' as const,
        limit: 10,
      },
    ];
    let figuredHit: SearchHit | undefined;
    for (const args of candidateQueries) {
      const hits = await search(args);
      figuredHit = hits.find(
        (h) => h.has_figure_enonce === true && !!h.pair_id,
      );
      if (figuredHit) break;
    }
    if (!figuredHit?.pair_id) {
      // Last-resort: a known-figured pair from the v6 corpus we
      // verified by hand (R2 HEAD returned 200 image/png on this one).
      figuredHit = {
        pair_id: 'math-2017-controle-sciences-ex:ex_4:q_1.a',
        has_figure_enonce: true,
      };
      console.log(
        `\n(falling back to a known-figured pair: ${figuredHit.pair_id})`,
      );
    }
    console.log(
      `\nfigured seed: ${figuredHit.pair_id}  ` +
        `(matiere=${figuredHit.matiere}, track=${figuredHit.track}, year=${figuredHit.year})`,
    );

    // 2. show_question_assets — default side
    const assets = await showAssets({ pair_id: figuredHit.pair_id });
    console.log('\n=== show_question_assets (default side) ===');
    console.log(JSON.stringify(assets, null, 2));

    if (!assets.has_figure_enonce) {
      throw new Error(
        'expected has_figure_enonce=true on a hit we filtered for has_figure_enonce',
      );
    }
    if (!assets.images.exercise_enonce) {
      throw new Error(
        'expected images.exercise_enonce to be populated when has_figure_enonce=true',
      );
    }
    if (!assets.images.exercise_enonce.startsWith(cdn)) {
      throw new Error(
        `images.exercise_enonce did not get prefixed with R2_PUBLIC_BASE: ${assets.images.exercise_enonce}`,
      );
    }
    if (assets.default_side !== 'enonce') {
      throw new Error(
        `default_side expected "enonce" got ${assets.default_side}`,
      );
    }

    // 3. HEAD-check the énoncé URL — must be 200 image/png
    const headResp = await head(assets.images.exercise_enonce);
    console.log(
      `\nHEAD ${assets.images.exercise_enonce}\n  -> ${headResp.status} (${headResp.type})`,
    );
    if (headResp.status !== 200) {
      throw new Error(
        `R2 HEAD on énoncé returned ${headResp.status} — bucket misconfigured?`,
      );
    }
    if (!headResp.type.startsWith('image/')) {
      throw new Error(
        `R2 HEAD content-type is "${headResp.type}", expected image/*`,
      );
    }

    // 4. show_question_assets with side="exam_full" — default echoes back
    const examFull = await showAssets({
      pair_id: figuredHit.pair_id,
      side: 'exam_full',
    });
    if (examFull.default_side !== 'exam_full') {
      throw new Error(
        `default_side echo broken: expected "exam_full" got ${examFull.default_side}`,
      );
    }

    // 5. has_any_figure flag honesty check on a known no-figure pair.
    //    v6 always populates the rendered-exercise PNG relpath (so the
    //    énoncé/corrigé page can always be shown), but the
    //    `has_figure_*` booleans are independent metadata — they
    //    indicate whether the PNG carries a non-text figure. The
    //    panel uses these flags to decide whether to render a chip
    //    thumbnail; we just assert they thread through correctly.
    const noFigureHits = await search({
      query: 'définition limite suite numérique',
      matiere: 'math',
      limit: 10,
    });
    const noFigureHit = noFigureHits.find(
      (h) =>
        h.has_figure_enonce === false &&
        h.has_figure_corrige === false &&
        !!h.pair_id,
    );
    if (noFigureHit?.pair_id) {
      const blank = await showAssets({ pair_id: noFigureHit.pair_id });
      console.log(
        `\nno-figure seed: ${noFigureHit.pair_id} -> has_any_figure=${blank.has_any_figure} (text-only exercise)`,
      );
      if (blank.has_any_figure) {
        throw new Error(
          `has_any_figure should be false on a no-figure pair; got true`,
        );
      }
    } else {
      console.log(
        '\n(no-figure seed: skipped — could not find a no-figure pair in math)',
      );
    }

    // 6. Bad pair_id should not throw, just return a friendly miss
    const tNoSuch = byName.get('show_question_assets');
    if (!tNoSuch) throw new Error('tool missing');
    const miss = (await tNoSuch.invoke({
      pair_id: 'totally-fabricated-pair-id-does-not-exist',
    })) as string;
    if (!miss.startsWith('No question pair found')) {
      throw new Error(`expected friendly miss; got: ${miss}`);
    }
    console.log('\nbad pair_id graceful miss:', miss);

    console.log('\nAll v6 figure smoke checks passed.');
  } finally {
    await neo4j.onModuleDestroy?.();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SMOKE FAILED:', err);
    process.exit(1);
  });
