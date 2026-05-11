/**
 * Idempotent payload-index creator for the v6 Qdrant collection
 * (`bac_qa_pairs_omni_v6`).
 *
 * Background. The v6 collection runs with Qdrant strict mode enabled
 * (`unindexed_filtering_retrieve=false`), so any filter on a non-indexed
 * payload field returns:
 *
 *   Bad request: Index required but not found for "<field>" of one of
 *   the following types: [keyword]. Help: Create an index for this key
 *   or use a different filter.
 *
 * The omni v6.5 ingest creates indexes for the metadata fields it
 * always writes (exam_id, exam_year, exercise_id_global, exercise_number,
 * filiere, has_answer, has_figure_corrige, has_figure_enonce,
 * ingest_version, matiere, session) but does NOT create indexes for
 * the lookup keys the backend uses to resolve `lemma:` URIs or to
 * fall back on legacy v1 exam handles:
 *
 *   - `pair_id_logical` — used by `QdrantClientProvider.getByPairId`
 *     (the canonical v6 join key). Without this index, every
 *     `show_question_assets` call and every `lemma:fig:…` /
 *     `lemma:pair:…` URI resolution throws "Index required".
 *
 *   - `pair_id`         — legacy v1 join key. Same code path falls
 *     back to this when `pair_id_logical` misses, so the same strict-
 *     mode error trips the fallback too.
 *
 *   - `exam`            — legacy v1 underscored exam handle, used as
 *     a fallback by `ReferencesService.scrollExamPairs` and by
 *     `list_exam_questions`. v6 exam handles use `exam_id` (already
 *     indexed); this index keeps the v1-shaped exam handles working.
 *
 * Run with:
 *
 *   cd backend
 *   npx ts-node --transpile-only scripts/ensure-v6-indexes.ts
 *
 * Reads QDRANT_URL / QDRANT_API_KEY / QDRANT_COLLECTION from the
 * environment (same as the backend service). Safe to run repeatedly
 * — Qdrant returns "already exists" for indexes that already exist
 * and the script treats that as success.
 */

import 'dotenv/config';

interface PayloadIndexSpec {
  field: string;
  schema: 'keyword' | 'integer' | 'bool' | 'float';
}

const REQUIRED_INDEXES: PayloadIndexSpec[] = [
  { field: 'pair_id_logical', schema: 'keyword' },
  { field: 'pair_id', schema: 'keyword' },
  { field: 'exam', schema: 'keyword' },
];

async function main(): Promise<void> {
  const baseUrl = process.env.QDRANT_URL?.replace(/\/+$/, '');
  const apiKey = process.env.QDRANT_API_KEY;
  const collection =
    process.env.QDRANT_COLLECTION ??
    process.env.QDRANT_COLLECTION_NAME ??
    'bac_qa_pairs_omni_v6';

  if (!baseUrl) {
    throw new Error('QDRANT_URL must be set.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers['api-key'] = apiKey;

  const infoRes = await fetch(`${baseUrl}/collections/${collection}`, {
    headers,
  });
  if (!infoRes.ok) {
    throw new Error(
      `Could not read collection ${collection}: ${infoRes.status} ${await infoRes.text()}`,
    );
  }
  const info = (await infoRes.json()) as {
    result: { payload_schema?: Record<string, { data_type?: string }> };
  };
  const existing = info.result.payload_schema ?? {};
  const existingFields = new Set(Object.keys(existing));
  console.log(
    `--- existing payload indexes on ${collection}: ${
      existingFields.size
        ? [...existingFields].sort().join(', ')
        : '(none)'
    } ---`,
  );

  for (const idx of REQUIRED_INDEXES) {
    if (existingFields.has(idx.field)) {
      console.log(`  ${idx.field} already indexed — skipping.`);
      continue;
    }
    const res = await fetch(
      `${baseUrl}/collections/${collection}/index?wait=true`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          field_name: idx.field,
          field_schema: idx.schema,
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Qdrant returns 4xx when an index already exists; surface and
      // continue rather than aborting the whole run.
      console.warn(
        `  ${idx.field}: create returned ${res.status} ${text.slice(0, 200)}`,
      );
      continue;
    }
    console.log(`  ${idx.field}: created (schema=${idx.schema}).`);
  }

  const afterRes = await fetch(`${baseUrl}/collections/${collection}`, {
    headers,
  });
  if (afterRes.ok) {
    const after = (await afterRes.json()) as {
      result: { payload_schema?: Record<string, { data_type?: string }> };
    };
    const fields = Object.keys(after.result.payload_schema ?? {}).sort();
    console.log(`\n--- payload indexes after run: ${fields.join(', ')} ---`);
  }
}

main()
  .then(() => {
    console.log('\nensure-v6-indexes complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('ensure-v6-indexes FAILED:', err);
    process.exit(1);
  });
