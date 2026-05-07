/**
 * Manual smoke test for the PR B domain tools — boots NestJS in standalone
 * mode and exercises each tool against the real Qdrant + Neo4j + NIM
 * endpoints from `backend/.env.local`. Invoke with:
 *
 *   npx ts-node --transpile-only scripts/smoke-tools.ts
 *
 * Not part of the unit test suite — wraps live network calls so it is
 * intentionally manual / offline-safe.
 */

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AgentToolsService } from '../src/agent/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const tools = app.get(AgentToolsService).getAll();
  const byName = new Map<string, StructuredToolInterface>(
    tools.map((t) => [t.name, t]),
  );

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
    console.log(summary.length > 1500 ? summary.slice(0, 1500) + '\n...' : summary);
  }

  try {
    await call('list_chapters', { matiere: 'math' });
    await call('list_topics', { matiere: 'math', limit: 10 });
    await call('list_exams', { matiere: 'math', year: 2017, limit: 10 });
    await call('count_questions', { matiere: 'math' });
    await call('count_questions', {
      matiere: 'math',
      chapter: 'Arithmétique',
      difficulty_max: 2,
    });
    await call('search_questions', {
      query: 'PGCD et équations diophantiennes',
      matiere: 'math',
      chapter: 'Arithmétique',
      limit: 3,
    });
    // Use the pair_id from the deterministic sample we saw in the probe.
    const seedPairId =
      'deepseek_v1__math__2017_controle_informatique_math__ex4__q1.c';
    await call('get_question_pair', { pair_id: seedPairId });
    await call('find_similar_questions', {
      pair_id: seedPairId,
      limit: 3,
      matiere: 'math',
    });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err);
  process.exit(1);
});
