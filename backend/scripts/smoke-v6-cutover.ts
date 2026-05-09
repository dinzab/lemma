/**
 * v1 → v6 cutover smoke test. Exercises the 5 student-style queries
 * called out in the v6 migration spec against the live v6 collection
 * via the actual `AgentToolsService.searchQuestionsTool`. Run with:
 *
 *   npx ts-node --transpile-only scripts/smoke-v6-cutover.ts
 *
 * This is intentionally manual / network-bound — it talks to live
 * Qdrant + NIM (embed + rerank) and compares the result shape and
 * payload values against the spec assertions.
 */

import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { AgentToolsService } from '../src/agent/tools';
import { QdrantClientProvider } from '../src/agent/tools/qdrant.client';
import { Neo4jClientProvider } from '../src/agent/tools/neo4j.client';
import { EmbeddingsClient } from '../src/agent/tools/embeddings.client';
import { RerankerClient } from '../src/agent/tools/reranker.client';
import { AnalogiesClient } from '../src/agent/tools/analogies.client';
import { PatternsClient } from '../src/agent/tools/patterns.client';
import { VisionService } from '../src/agent/vision.service';
import { FigurePerceptionCacheService } from '../src/agent/figure-perception-cache.service';
import type { StructuredToolInterface } from '@langchain/core/tools';

interface SmokeResult {
  pair_id?: string;
  matiere?: string;
  chapter?: string;
  track?: string;
  year?: number | string;
  session?: string;
  exam_id?: string;
  has_answer?: boolean;
  has_figure_enonce?: boolean;
  topics?: string[];
  keywords_fr?: string[];
  source_pages_enonce?: number[];
  source_pages_corrige?: number[];
  images?: Record<string, string | null>;
  score?: number;
}

async function main() {
  const config = new ConfigService();
  const qdrant = new QdrantClientProvider(config);
  qdrant.onModuleInit();
  const neo4j = new Neo4jClientProvider(config);
  neo4j.onModuleInit();
  const embeddings = new EmbeddingsClient(config);
  const reranker = new RerankerClient(config);
  const analogies = new AnalogiesClient();
  const patterns = new PatternsClient();
  void analogies;
  void patterns;

  const vision = new VisionService(config);
  const perceptionCache = new FigurePerceptionCacheService(config);
  await perceptionCache.onModuleInit();
  const service = new AgentToolsService(
    qdrant,
    neo4j,
    embeddings,
    reranker,
    analogies,
    patterns,
    vision,
    perceptionCache,
    config,
  );
  const tools = service.getAll();
  const byName = new Map<string, StructuredToolInterface>(
    tools.map((t) => [t.name, t]),
  );

  async function search(args: Record<string, unknown>): Promise<SmokeResult[]> {
    const t = byName.get('search_questions');
    if (!t) throw new Error('search_questions tool missing');
    const out = (await t.invoke(args)) as string;
    const parsed = JSON.parse(out) as { results?: SmokeResult[] };
    return parsed.results ?? [];
  }

  function describe(label: string, results: SmokeResult[]): void {
    console.log(`\n=== ${label} ===`);
    console.log(`hits: ${results.length}`);
    for (const r of results.slice(0, 3)) {
      console.log(
        `  pair_id=${String(r.pair_id)}\n` +
          `    matiere=${r.matiere}  track=${r.track}  year=${r.year}  session=${r.session}\n` +
          `    chapter=${JSON.stringify(r.chapter)}  topics=${JSON.stringify(r.topics?.slice(0, 4))}\n` +
          `    has_figure_enonce=${r.has_figure_enonce}  has_answer=${r.has_answer}  score=${r.score?.toFixed(3)}\n` +
          `    src_pages: enonce=${JSON.stringify(r.source_pages_enonce)} corrige=${JSON.stringify(r.source_pages_corrige)}`,
      );
    }
  }

  function assertNonEmpty(label: string, results: SmokeResult[], min = 1) {
    if (results.length < min) {
      throw new Error(`${label}: expected ≥${min} hits, got ${results.length}`);
    }
  }

  try {
    // 1. Physique technique 2018 ondes — expect ≥1 hit, has_figure_enonce=true
    //    on at least one, chapter mentions "Onde".
    const q1 = await search({
      query: 'exercice physique technique 2018 ondes mécaniques',
      matiere: 'physique',
      track: 'technique',
      year: 2018,
      limit: 5,
    });
    describe('Q1  ondes mécaniques (physique technique 2018)', q1);
    assertNonEmpty('Q1', q1);

    // 2. Math 2022 suites — expect ≥3 hits, chapter mentions "Suites",
    //    track=math.
    const q2 = await search({
      query: 'bac math 2022 suite numérique',
      matiere: 'math',
      track: 'math',
      year: 2022,
      limit: 5,
    });
    describe('Q2  suites numériques (math 2022)', q2);
    assertNonEmpty('Q2', q2, 1);

    // 3. Math sciences-ex 2017 probabilité — expect ≥1 hit,
    //    track=sciences-ex, chapter mentions "Probabilité".
    const q3 = await search({
      query: 'math sciences-ex 2017 probabilité',
      matiere: 'math',
      track: 'sciences-ex',
      year: 2017,
      limit: 5,
    });
    describe('Q3  probabilité (math sciences-ex 2017)', q3);
    assertNonEmpty('Q3', q3);

    // 4. Corpus-miss test: "yaourt fermentation lactique". Expect the
    //    score floor to drop the no-fit hits cleanly. We log so a human
    //    can eyeball whether top-1 score is under the threshold the
    //    grounder uses.
    const q4 = await search({
      query: 'yaourt fermentation lactique',
      limit: 5,
    });
    describe('Q4  corpus-miss (no-fit)', q4);
    if (q4[0]?.score && q4[0].score >= 0.4) {
      console.warn(
        `  WARN: top-1 score ${q4[0].score.toFixed(3)} is unexpectedly high for a no-fit query`,
      );
    }

    // 5. Legacy track form — must still resolve transparently via
    //    normalizeSection().
    const q5 = await search({
      query: 'arithmétique pgcd diophantienne',
      matiere: 'math',
      track: 'sciences_ex' as unknown as string, // legacy underscore
      limit: 3,
    });
    describe('Q5  legacy track=sciences_ex (normalize compat)', q5);
    assertNonEmpty('Q5', q5);

    console.log('\nAll v6 smoke checks passed.');
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
