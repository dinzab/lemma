/**
 * Unit tests for the `reference-doc` helper module — the Session 21
 * payload bridge.
 *
 * The tests pin the four behaviours the rest of the codebase relies
 * on:
 *
 *  1. `readReferenceDoc` is defensive — bad / missing fields return
 *     `null` rather than throw so the existing énoncé-only flow
 *     keeps working on non-technique pairs and on payloads ingested
 *     before `omni_v6.6`.
 *  2. `formatReferenceDocForLLM` truncates `text` to the agreed
 *     char budget and reports the original length.
 *  3. `collectReferenceDocsForLLM` dedupes by
 *     `(exam_id, reference_doc_kind)` — when 3 pairs from the same
 *     technique exam come back from Qdrant we only emit ONE
 *     dossier so the LLM context isn't repeated.
 *  4. The integration is kind-agnostic — the lookup table resolves
 *     `dossier_technique`, future `dossier_comptable`,
 *     `mcd_schema`, `chimie_preamble`, and falls back to a Title
 *     Cased label for unknown kinds.
 */
import {
  collectReferenceDocsForLLM,
  formatReferenceDocForLLM,
  readReferenceDoc,
  referenceDocKindLabel,
  resolveReferenceDocCharBudget,
  REFERENCE_DOC_DEFAULT_CHAR_BUDGET,
} from './reference-doc';

const CDN = 'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev';

function buildDossierPayload(over: Partial<Record<string, unknown>> = {}) {
  return {
    pair_id_logical: 'technique-2022-principale-technique:ex_B2:q_4',
    matiere: 'technique',
    exam_id: 'technique-2022-principale-technique',
    has_reference_doc: true,
    reference_doc_kind: 'dossier_technique',
    reference_doc_text:
      '# Système de levage\n\nLe motoréducteur M entraîne le tambour T.',
    reference_doc_figures: [
      {
        id: 'enonce_p2_f1',
        label: 'figure 1',
        description: 'Diagramme cinématique du levage.',
        page_index: 1,
        bbox_pct: [0.1, 0.1, 0.9, 0.5],
      },
    ],
    reference_doc_pages_relpaths: [
      'technique-2022-principale-technique/dossier/p1.png',
      'technique-2022-principale-technique/dossier/p2.png',
    ],
    reference_doc_pages: [0, 1],
    reference_doc_split_method: 'fast_block_v1',
    n_reference_doc_figures: 1,
    n_reference_doc_pages: 2,
    ingest_version: 'omni_v6.6',
    ...over,
  };
}

describe('referenceDocKindLabel', () => {
  it('resolves known kinds via the lookup table', () => {
    expect(referenceDocKindLabel('dossier_technique')).toBe(
      'Dossier technique',
    );
    expect(referenceDocKindLabel('dossier_comptable')).toBe(
      'Dossier comptable',
    );
    expect(referenceDocKindLabel('mcd_schema')).toBe('Schéma MCD');
    expect(referenceDocKindLabel('chimie_preamble')).toBe(
      'Préambule de chimie',
    );
  });

  it('falls back to a Title-cased label for an unknown kind', () => {
    expect(referenceDocKindLabel('annexe_droit')).toBe('Annexe Droit');
    expect(referenceDocKindLabel('plain')).toBe('Plain');
  });
});

describe('resolveReferenceDocCharBudget', () => {
  it('returns the default when the env var is absent', () => {
    expect(resolveReferenceDocCharBudget({})).toBe(
      REFERENCE_DOC_DEFAULT_CHAR_BUDGET,
    );
  });

  it('reads BACRAG_DOSSIER_CHAR_BUDGET when set', () => {
    expect(
      resolveReferenceDocCharBudget({ BACRAG_DOSSIER_CHAR_BUDGET: '6000' }),
    ).toBe(6000);
  });

  it('clamps to the [256, 20000] range', () => {
    expect(
      resolveReferenceDocCharBudget({ BACRAG_DOSSIER_CHAR_BUDGET: '0' }),
    ).toBe(256);
    expect(
      resolveReferenceDocCharBudget({ BACRAG_DOSSIER_CHAR_BUDGET: '50000' }),
    ).toBe(20_000);
  });

  it('falls back to the default on a non-numeric value', () => {
    expect(
      resolveReferenceDocCharBudget({ BACRAG_DOSSIER_CHAR_BUDGET: 'lots' }),
    ).toBe(REFERENCE_DOC_DEFAULT_CHAR_BUDGET);
  });
});

describe('readReferenceDoc', () => {
  it('parses a well-formed v6.6 dossier payload', () => {
    const raw = readReferenceDoc(buildDossierPayload());
    expect(raw).not.toBeNull();
    if (!raw) return;
    expect(raw.kind).toBe('dossier_technique');
    expect(raw.text).toContain('motoréducteur');
    expect(raw.figures).toHaveLength(1);
    expect(raw.figures[0].id).toBe('enonce_p2_f1');
    expect(raw.figures[0].bbox_pct).toEqual([0.1, 0.1, 0.9, 0.5]);
    expect(raw.pages).toHaveLength(2);
    expect(raw.split_method).toBe('fast_block_v1');
  });

  it('returns null when the payload has no dossier (non-technique pair)', () => {
    expect(
      readReferenceDoc({
        matiere: 'math',
        question_text: 'q',
        answer_text: 'a',
      }),
    ).toBeNull();
  });

  it('returns null when has_reference_doc is explicitly false', () => {
    expect(
      readReferenceDoc(buildDossierPayload({ has_reference_doc: false })),
    ).toBeNull();
  });

  it('returns null when reference_doc_text is empty', () => {
    expect(
      readReferenceDoc(buildDossierPayload({ reference_doc_text: '' })),
    ).toBeNull();
  });

  it('drops malformed figure entries silently and keeps the well-formed ones', () => {
    const raw = readReferenceDoc(
      buildDossierPayload({
        reference_doc_figures: [
          { id: 'good', label: 'figure 1', description: '', page_index: 0 },
          { id: '', label: 'figure 2', page_index: 1 },
          { id: 'bad', label: '', page_index: 2 },
          'not an object',
          { id: 'badpage', label: 'figure 3', page_index: -1 },
        ],
      }),
    );
    expect(raw?.figures).toHaveLength(1);
    expect(raw?.figures[0].id).toBe('good');
  });

  it('returns null when both figures and pages are empty', () => {
    expect(
      readReferenceDoc(
        buildDossierPayload({
          reference_doc_figures: [],
          reference_doc_pages_relpaths: [],
          reference_doc_pages: [],
        }),
      ),
    ).toBeNull();
  });

  it('uses position as a fallback page index when the indices array is shorter', () => {
    const raw = readReferenceDoc(
      buildDossierPayload({
        reference_doc_pages: [],
        reference_doc_pages_relpaths: ['a.png', 'b.png', 'c.png'],
      }),
    );
    expect(raw?.pages.map((p) => p.page_index)).toEqual([0, 1, 2]);
  });
});

describe('formatReferenceDocForLLM', () => {
  it('builds page URLs and per-figure page_png + citation', () => {
    const raw = readReferenceDoc(buildDossierPayload());
    if (!raw) throw new Error('expected parsed dossier');
    const formatted = formatReferenceDocForLLM(raw, {
      cdnBase: CDN,
      examHandle: 'technique-2022-principale-technique',
    });
    expect(formatted.kind_label).toBe('Dossier technique');
    expect(formatted.pages[0].url).toBe(
      `${CDN}/ocr_omni/technique-2022-principale-technique/dossier/p1.png`,
    );
    expect(formatted.figures[0].page_png).toBe(
      `${CDN}/ocr_omni/technique-2022-principale-technique/dossier/p2.png`,
    );
    expect(formatted.figures[0].citation?.ref_uri).toBe(
      'lemma:dossier_fig:technique-2022-principale-technique:enonce_p2_f1',
    );
  });

  it('truncates text to the configured budget and reports the original length', () => {
    const fullText = 'a'.repeat(12_000);
    const raw = readReferenceDoc(
      buildDossierPayload({ reference_doc_text: fullText }),
    );
    if (!raw) throw new Error('expected parsed dossier');
    const formatted = formatReferenceDocForLLM(raw, { charBudget: 4000 });
    expect(formatted.text).toHaveLength(4000);
    expect(formatted.text_truncated).toBe(true);
    expect(formatted.text_full_length).toBe(12_000);
  });

  it('omits the citation when no exam handle is provided', () => {
    const raw = readReferenceDoc(buildDossierPayload());
    if (!raw) throw new Error('expected parsed dossier');
    const formatted = formatReferenceDocForLLM(raw);
    expect(formatted.figures[0].citation).toBeNull();
  });
});

describe('collectReferenceDocsForLLM', () => {
  it('dedupes by (exam_id, reference_doc_kind) across multiple pairs', () => {
    const payload = buildDossierPayload();
    const out = collectReferenceDocsForLLM([
      { payload },
      { payload }, // same exam — should dedupe
      { payload }, // same exam — should dedupe
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].exam_handle).toBe('technique-2022-principale-technique');
    expect(out[0].doc.kind).toBe('dossier_technique');
  });

  it('emits one dossier per (exam_id, reference_doc_kind) pair', () => {
    const a = buildDossierPayload();
    const b = buildDossierPayload({
      exam_id: 'technique-2023-principale-technique',
      pair_id_logical: 'technique-2023-principale-technique:ex_A:q_1',
    });
    const out = collectReferenceDocsForLLM([
      { payload: a },
      { payload: b },
      { payload: a },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.exam_handle).sort()).toEqual([
      'technique-2022-principale-technique',
      'technique-2023-principale-technique',
    ]);
  });

  it('skips points without an exam_id', () => {
    const payload = buildDossierPayload({ exam_id: undefined });
    const out = collectReferenceDocsForLLM([{ payload }]);
    expect(out).toHaveLength(0);
  });

  it('skips points without a usable dossier', () => {
    const out = collectReferenceDocsForLLM([
      { payload: { matiere: 'math', exam_id: 'math-2020' } },
    ]);
    expect(out).toHaveLength(0);
  });
});
