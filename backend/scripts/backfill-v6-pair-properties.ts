/**
 * One-off backfill that stamps the v1-shaped `critic_label='correct'` and
 * `under_gate=false` properties onto every v6 Pair node in Neo4j.
 *
 * Background. The v6 ingest set both properties on the Qdrant payload
 * (so the existing mandatory Qdrant filter still passes 100% of v6
 * points) but skipped the matching Neo4j writes. Every Cypher query
 * that joined `Pair`-by-`FROM_EXAM` and filtered with
 * `p.critic_label='correct' AND p.under_gate=false` therefore returned
 * `count(p) = 0` for v6 exams, breaking `list_exams` / `list_sections`.
 *
 * The agent-tools fix in this revision coalesces null to the v1 "good"
 * defaults inside the Cypher itself, so this backfill is **optional** —
 * it just normalises the data layer so future code doesn't need to know
 * about the gotcha.
 *
 * Idempotent: only writes properties that are missing, never overwrites
 * an already-set value (so a future ingest that legitimately sets
 * `critic_label='incorrect'` or `under_gate=true` won't be clobbered).
 *
 * Run with:
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/backfill-v6-pair-properties.ts
 *
 * Reads NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD from the
 * environment (same as the backend service).
 */

import 'dotenv/config';
import neo4j from 'neo4j-driver';

async function main() {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !username || !password) {
    throw new Error(
      'NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD must all be set.',
    );
  }
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  const session = driver.session();
  const num = (v: unknown): number =>
    v && typeof (v as { toNumber?: () => number }).toNumber === 'function'
      ? (v as { toNumber: () => number }).toNumber()
      : (v as number);

  try {
    console.log(
      '--- before: v6 Pair critic_label / under_gate distribution ---',
    );
    const before = await session.run(
      `MATCH (p:Pair) WHERE p.ingest_version = 'omni_v6'
       RETURN coalesce(p.critic_label,'<null>') AS c,
              coalesce(toString(p.under_gate),'<null>') AS g,
              count(*) AS n
       ORDER BY n DESC`,
    );
    before.records.forEach((rec) =>
      console.log(
        `  critic_label=${rec.get('c')} under_gate=${rec.get('g')} n=${num(
          rec.get('n'),
        )}`,
      ),
    );

    console.log('\n--- backfilling critic_label=correct on null v6 pairs ---');
    const c = await session.run(
      `MATCH (p:Pair)
       WHERE p.ingest_version = 'omni_v6' AND p.critic_label IS NULL
       SET p.critic_label = 'correct'
       RETURN count(p) AS updated`,
    );
    console.log(`  rows updated: ${num(c.records[0]?.get('updated'))}`);

    console.log('\n--- backfilling under_gate=false on null v6 pairs ---');
    const g = await session.run(
      `MATCH (p:Pair)
       WHERE p.ingest_version = 'omni_v6' AND p.under_gate IS NULL
       SET p.under_gate = false
       RETURN count(p) AS updated`,
    );
    console.log(`  rows updated: ${num(g.records[0]?.get('updated'))}`);

    console.log(
      '\n--- after: v6 Pair critic_label / under_gate distribution ---',
    );
    const after = await session.run(
      `MATCH (p:Pair) WHERE p.ingest_version = 'omni_v6'
       RETURN coalesce(p.critic_label,'<null>') AS c,
              coalesce(toString(p.under_gate),'<null>') AS g,
              count(*) AS n
       ORDER BY n DESC`,
    );
    after.records.forEach((rec) =>
      console.log(
        `  critic_label=${rec.get('c')} under_gate=${rec.get('g')} n=${num(
          rec.get('n'),
        )}`,
      ),
    );

    console.log(
      '\n--- spot-check: 2022 sciences-ex math now reports a real pair count ---',
    );
    const spot = await session.run(
      `MATCH (e:Exam)
       WHERE e.year=2022
         AND coalesce(e.filiere,e.track)='sciences-ex'
         AND coalesce(e.matiere,e.subject)='math'
       OPTIONAL MATCH (p:Pair)-[:FROM_EXAM]->(e)
         WHERE p.critic_label='correct' AND p.under_gate=false
       RETURN e.exam_id AS exam_id, count(p) AS pair_count`,
    );
    spot.records.forEach((rec) =>
      console.log(
        `  exam_id=${rec.get('exam_id')} pair_count=${num(
          rec.get('pair_count'),
        )}`,
      ),
    );
  } finally {
    await session.close();
    await driver.close();
  }
}

main()
  .then(() => {
    console.log('\nBackfill complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Backfill FAILED:', err);
    process.exit(1);
  });
