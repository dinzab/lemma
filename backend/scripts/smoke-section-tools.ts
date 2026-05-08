/**
 * Lightweight smoke test for the two new section/exercise tools, without
 * the full Nest app (skips Postgres/checkpointer wiring). Hits live
 * Qdrant + Neo4j only. Run with:
 *
 *   npx ts-node --transpile-only scripts/smoke-section-tools.ts
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

async function main() {
  const config = new ConfigService();
  const qdrant = new QdrantClientProvider(config);
  qdrant.onModuleInit();
  const neo4j = new Neo4jClientProvider(config);
  neo4j.onModuleInit();
  // The other clients are not used by the two new tools but the
  // service constructor takes them all; pass throwaway instances.
  const embeddings = new EmbeddingsClient(config);
  const reranker = new RerankerClient(config);
  const analogies = new AnalogiesClient();
  const patterns = new PatternsClient();
  // AnalogiesClient / PatternsClient lazy-load on first call, so calling
  // them here is fine — we don't exercise them in this smoke.
  void analogies;
  void patterns;

  const service = new AgentToolsService(
    qdrant,
    neo4j,
    embeddings,
    reranker,
    analogies,
    patterns,
  );
  const tools = service.getAll();
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function call(name: string, args: Record<string, unknown>) {
    const t = byName.get(name);
    if (!t) throw new Error(`Tool not found: ${name}`);
    const out = await t.invoke(args);
    let parsed: unknown = out;
    try {
      parsed = JSON.parse(out as string);
    } catch {
      // not JSON
    }
    console.log(`\n=== ${name} ===`);
    console.log(`args: ${JSON.stringify(args)}`);
    const summary = JSON.stringify(parsed, null, 2);
    console.log(
      summary.length > 2000 ? summary.slice(0, 2000) + '\n...' : summary,
    );
  }

  try {
    await call('list_sections', {});
    await call('count_questions', { matiere: 'math', track: 'sciences_ex' });
    await call('count_questions', { matiere: 'math', track: 'math' });
    await call('list_exam_questions', {
      exam: '2017_controle_informatique_math',
      exercise_number: 4,
    });
    await call('list_exam_questions', {
      exam: '2017_controle_informatique_math',
    });
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
