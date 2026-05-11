import {
  buildImageUrl,
  formatFiguresForLLM,
  formatPairForLLM,
  formatRerankPassage,
  readFigureEntries,
} from './index';
import {
  buildExamCitation,
  buildExerciseCitation,
  buildFigureCitation,
  buildPairCitation,
  parsePairId,
} from '../citations';

/**
 * Unit tests for `buildImageUrl`.
 *
 * Pinning the contract that — regardless of how `R2_PUBLIC_BASE` is
 * configured (with or without the `/ocr_omni` path suffix) and
 * regardless of whether the relpath itself happens to include the
 * prefix — the function always produces the same canonical URL with
 * exactly one `ocr_omni/` segment between the bucket origin and the
 * relpath. Pre-fix, the bare-bucket form returned a 404-ing URL.
 */
describe('buildImageUrl', () => {
  const RELPATH =
    '2020_principale_economie_gestion_math/exercises_v4/exercise_1_enonce.png';
  const EXPECTED =
    'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev/ocr_omni/' +
    '2020_principale_economie_gestion_math/exercises_v4/exercise_1_enonce.png';

  it('inserts the ocr_omni/ prefix when the base is the bare bucket origin', () => {
    expect(
      buildImageUrl(
        RELPATH,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev',
      ),
    ).toBe(EXPECTED);
  });

  it('does not duplicate the prefix when the base already ends with /ocr_omni', () => {
    expect(
      buildImageUrl(
        RELPATH,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev/ocr_omni',
      ),
    ).toBe(EXPECTED);
  });

  it('tolerates a trailing slash on the base', () => {
    expect(
      buildImageUrl(
        RELPATH,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev/ocr_omni/',
      ),
    ).toBe(EXPECTED);
    expect(
      buildImageUrl(
        RELPATH,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev/',
      ),
    ).toBe(EXPECTED);
  });

  it('does not duplicate the prefix when the relpath already includes it', () => {
    expect(
      buildImageUrl(
        `ocr_omni/${RELPATH}`,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev',
      ),
    ).toBe(EXPECTED);
  });

  it('strips a leading slash on the relpath', () => {
    expect(
      buildImageUrl(
        `/${RELPATH}`,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev',
      ),
    ).toBe(EXPECTED);
  });

  it('returns null for empty / non-string relpaths', () => {
    expect(buildImageUrl('', 'https://pub-x.r2.dev/ocr_omni')).toBeNull();
    expect(buildImageUrl(null, 'https://pub-x.r2.dev/ocr_omni')).toBeNull();
    expect(
      buildImageUrl(undefined, 'https://pub-x.r2.dev/ocr_omni'),
    ).toBeNull();
    expect(buildImageUrl(42, 'https://pub-x.r2.dev/ocr_omni')).toBeNull();
  });

  it('falls back to the raw relpath when no cdnBase is configured', () => {
    // The frontend then either composes its own URL or shows a "no
    // asset" placeholder — the API contract is "raw relpath, never
    // crash".
    expect(buildImageUrl(RELPATH, undefined)).toBe(RELPATH);
    expect(buildImageUrl(RELPATH, '')).toBe(RELPATH);
  });
});

/**
 * Tests for the v6 `enonce_figures` / `corrige_figures` payload reader.
 *
 * The May 9 2026 figures injection populated these arrays for ~5,481
 * pairs and 13,935 entries total. The reader needs to be permissive
 * enough that a malformed entry on a single pair (truncated caption,
 * missing relpath, accidental `null` slot) doesn't crash search /
 * rerank for the whole turn — which is why every guard rail returns
 * the empty / partial array instead of throwing.
 */
describe('readFigureEntries', () => {
  it('returns the well-formed entries on the requested side', () => {
    const payload = {
      enonce_figures: [
        {
          label: 'figure 1',
          description: 'Schéma du circuit RC avec un condensateur de 100µF.',
          relpath:
            '2018_principale_physique_sciences-ex/figures/enonce_p1_f1.png',
        },
        {
          label: 'figure 2',
          description: 'Tableau de variations de la fonction f.',
          relpath:
            '2018_principale_physique_sciences-ex/figures/enonce_p1_f2.png',
        },
      ],
      corrige_figures: [
        {
          label: 'figure 1',
          description: 'Tracé de la solution avec annotations.',
          relpath:
            '2018_principale_physique_sciences-ex/figures/corrige_p3_f1.png',
        },
      ],
    };
    const enonce = readFigureEntries(payload, 'enonce');
    const corrige = readFigureEntries(payload, 'corrige');
    expect(enonce).toHaveLength(2);
    expect(enonce[0].label).toBe('figure 1');
    expect(enonce[0].relpath).toContain('enonce_p1_f1.png');
    expect(corrige).toHaveLength(1);
    expect(corrige[0].relpath).toContain('corrige_p3_f1.png');
  });

  it('returns [] when the array field is absent (older payload)', () => {
    expect(readFigureEntries({}, 'enonce')).toEqual([]);
    expect(readFigureEntries({ enonce_figures: undefined }, 'enonce')).toEqual(
      [],
    );
    expect(readFigureEntries({ enonce_figures: null }, 'enonce')).toEqual([]);
  });

  it('returns [] when the field is the wrong type', () => {
    expect(
      readFigureEntries({ enonce_figures: 'not-an-array' }, 'enonce'),
    ).toEqual([]);
    expect(readFigureEntries({ enonce_figures: { 0: 'x' } }, 'enonce')).toEqual(
      [],
    );
  });

  it('drops malformed entries silently and keeps the rest', () => {
    const payload = {
      enonce_figures: [
        // Valid
        {
          label: 'figure 1',
          description: 'OK caption',
          relpath: 'a/figures/x.png',
        },
        // Missing relpath — drop
        { label: 'figure 2', description: 'caption only' },
        // Wrong type for description — drop
        { label: 'figure 3', description: 42, relpath: 'a/figures/y.png' },
        // Empty relpath — drop (would build a URL pointing at the bucket root)
        { label: 'figure 4', description: 'cap', relpath: '' },
        // null slot — drop
        null,
        // Another valid
        {
          label: 'figure 5',
          description: 'second OK',
          relpath: 'a/figures/z.png',
        },
      ],
    };
    const out = readFigureEntries(payload, 'enonce');
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.label)).toEqual(['figure 1', 'figure 5']);
  });

  it('tolerates a non-object payload (defensive)', () => {
    expect(readFigureEntries(null, 'enonce')).toEqual([]);
    expect(readFigureEntries(undefined, 'corrige')).toEqual([]);
    expect(readFigureEntries('not-a-payload', 'enonce')).toEqual([]);
  });

  /**
   * v6 omni payloads store figures as a flat list of relpaths under
   * `figure_relpaths_{enonce,corrige}` with no per-figure captions
   * or labels. The reader normalises them into the same FigureEntry
   * shape, synthesising a positional label and leaving description
   * empty. These tests pin the v6 contract so an ingest rollback to
   * the v4 schema would still keep working (rich shape wins) but a
   * v6 payload renders figures correctly.
   */
  it('reads v6 figure_relpaths_enonce as synthesised FigureEntry list', () => {
    const out = readFigureEntries(
      {
        figure_relpaths_enonce: [
          '2017_controle_sciences_ex_math/figures/enonce_p2_f1.png',
          '2017_controle_sciences_ex_math/figures/enonce_p2_f2.png',
        ],
        has_figure_enonce: true,
      },
      'enonce',
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      label: 'Figure 1',
      description: '',
      relpath: '2017_controle_sciences_ex_math/figures/enonce_p2_f1.png',
    });
    expect(out[1].label).toBe('Figure 2');
    expect(out[1].relpath).toContain('enonce_p2_f2.png');
  });

  it('reads v6 figure_relpaths_corrige and drops empty / non-string entries', () => {
    const out = readFigureEntries(
      {
        figure_relpaths_corrige: [
          'a/figures/corrige_p3_f1.png',
          '',
          null,
          42,
          'a/figures/corrige_p3_f2.png',
        ],
      },
      'corrige',
    );
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.relpath)).toEqual([
      'a/figures/corrige_p3_f1.png',
      'a/figures/corrige_p3_f2.png',
    ]);
    expect(out.map((f) => f.label)).toEqual(['Figure 1', 'Figure 2']);
  });

  it('prefers the rich v1/v4 shape when both keys are populated', () => {
    const out = readFigureEntries(
      {
        enonce_figures: [
          {
            label: 'figure 1',
            description: 'Rich caption from v4 ingest.',
            relpath: 'rich/enonce_f1.png',
          },
        ],
        figure_relpaths_enonce: ['flat/enonce_f1.png'],
      },
      'enonce',
    );
    expect(out).toHaveLength(1);
    expect(out[0].relpath).toBe('rich/enonce_f1.png');
    expect(out[0].description).toBe('Rich caption from v4 ingest.');
  });

  it('falls back to v6 flat list when v4 rich array is empty', () => {
    const out = readFigureEntries(
      {
        enonce_figures: [],
        figure_relpaths_enonce: ['flat/enonce_f1.png'],
      },
      'enonce',
    );
    expect(out).toHaveLength(1);
    expect(out[0].relpath).toBe('flat/enonce_f1.png');
  });
});

/**
 * Tests for `formatFiguresForLLM`, the helper that maps raw payload
 * entries onto the `{label, caption, url}` shape consumed by the
 * agent and the frontend chips.
 *
 * Two guarantees worth pinning:
 *  1. URL composition routes through `buildImageUrl`, so the
 *     `ocr_omni/` prefix is inserted even when `R2_PUBLIC_BASE` is
 *     the bare bucket origin.
 *  2. Captions are truncated to the preview cap unless `full=true`,
 *     so a 600-char caption doesn't bloat every search result.
 */
describe('formatFiguresForLLM', () => {
  const CDN = 'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev';

  it('builds public URLs and preserves labels', () => {
    const out = formatFiguresForLLM(
      {
        enonce_figures: [
          {
            label: 'figure 1',
            description: 'short caption',
            relpath: '2018_p_phys/figures/enonce_p1_f1.png',
          },
        ],
        corrige_figures: [],
      },
      CDN,
    );
    expect(out.enonce).toHaveLength(1);
    expect(out.enonce[0].label).toBe('figure 1');
    expect(out.enonce[0].caption).toBe('short caption');
    expect(out.enonce[0].url).toBe(
      `${CDN}/ocr_omni/2018_p_phys/figures/enonce_p1_f1.png`,
    );
    expect(out.corrige).toEqual([]);
  });

  it('truncates captions for non-full callers, preserves them for full', () => {
    const longCaption = 'x'.repeat(800);
    const payload = {
      enonce_figures: [
        {
          label: 'figure 1',
          description: longCaption,
          relpath: 'p/figures/x.png',
        },
      ],
    };
    const truncated = formatFiguresForLLM(payload, CDN);
    expect(truncated.enonce[0].caption.length).toBeLessThan(longCaption.length);
    expect(truncated.enonce[0].caption.endsWith('…')).toBe(true);

    const full = formatFiguresForLLM(payload, CDN, { full: true });
    expect(full.enonce[0].caption).toBe(longCaption);
  });

  it('returns empty arrays when the payload has no figure fields', () => {
    expect(formatFiguresForLLM({}, CDN)).toEqual({
      enonce: [],
      corrige: [],
    });
  });
});

/**
 * Tests for `formatPairForLLM` — the function that produces what the
 * agent and the frontend ultimately read for each search hit.
 *
 * The two regression-critical pinning behaviours:
 *
 *  1. `has_figure_*` / `n_*_figures` are recomputed FROM THE ARRAYS,
 *     not read from the legacy boolean payload fields. This is the
 *     fix for the May 9 2026 stale-boolean bug where ~600 pairs had
 *     populated arrays but `has_figure_*=false`.
 *  2. The new `figures` field is always present on the response,
 *     even when both arrays are empty (it's `{enonce: [], corrige:
 *     []}`), so the frontend can rely on the field's existence.
 */
describe('formatPairForLLM', () => {
  const CDN = 'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev';

  it('surfaces figures.{enonce,corrige} as {label,caption,url}', () => {
    const point = {
      id: 'p1',
      payload: {
        pair_id_logical: 'physique-2018-principale-sciences-ex:ex_2:q_3',
        question_text: 'Question text',
        answer_text: 'Answer text',
        enonce_figures: [
          {
            label: 'figure 1',
            description: 'Schéma du circuit RC.',
            relpath: '2018_p_phys/figures/enonce_p1_f1.png',
          },
        ],
        corrige_figures: [
          {
            label: 'figure 1',
            description: 'Tracé de la solution.',
            relpath: '2018_p_phys/figures/corrige_p3_f1.png',
          },
        ],
      },
    };
    const out = formatPairForLLM(point, { cdnBase: CDN });
    const figures = out.figures as {
      enonce: { label: string; caption: string; url: string }[];
      corrige: { label: string; caption: string; url: string }[];
    };
    expect(figures.enonce).toHaveLength(1);
    expect(figures.enonce[0].caption).toContain('circuit RC');
    expect(figures.enonce[0].url).toBe(
      `${CDN}/ocr_omni/2018_p_phys/figures/enonce_p1_f1.png`,
    );
    expect(figures.corrige).toHaveLength(1);
  });

  it('recomputes has_figure_* / n_*_figures from arrays (ignoring stale booleans)', () => {
    // Reproduces the May 9 stale-boolean bug: `has_figure_enonce` is
    // false in the payload, but `enonce_figures` has entries. The
    // formatter must trust the array, not the boolean.
    const point = {
      id: 'p2',
      payload: {
        has_figure_enonce: false, // stale!
        has_figure_corrige: false, // stale!
        n_enonce_figures: 0, // stale!
        n_corrige_figures: 0, // stale!
        enonce_figures: [
          {
            label: 'figure 1',
            description: 'cap',
            relpath: 'p/figures/x.png',
          },
          {
            label: 'figure 2',
            description: 'cap',
            relpath: 'p/figures/y.png',
          },
        ],
        corrige_figures: [
          {
            label: 'figure 1',
            description: 'cap',
            relpath: 'p/figures/z.png',
          },
        ],
      },
    };
    const out = formatPairForLLM(point);
    expect(out.has_figure_enonce).toBe(true);
    expect(out.has_figure_corrige).toBe(true);
    expect(out.n_enonce_figures).toBe(2);
    expect(out.n_corrige_figures).toBe(1);
  });

  it('always emits a figures field even when the arrays are absent', () => {
    const point = {
      id: 'p3',
      payload: { question_text: 'q', answer_text: 'a' },
    };
    const out = formatPairForLLM(point);
    expect(out.figures).toEqual({ enonce: [], corrige: [] });
    expect(out.has_figure_enonce).toBe(false);
    expect(out.has_figure_corrige).toBe(false);
  });
});

/**
 * Tests for `formatRerankPassage` — the cross-encoder input. The
 * goal is to verify that figure captions are appended (so a query
 * about "circuit RC charge condensateur" can rerank a pair higher
 * even when only the figure caption mentions those words), without
 * letting one figure-heavy pair dominate the passage.
 */
describe('formatRerankPassage', () => {
  it('returns Question/Answer only when no figures are present', () => {
    const point = {
      id: 'p1',
      payload: { question_text: 'Q', answer_text: 'A' },
    };
    expect(formatRerankPassage(point)).toBe('Question: Q\nAnswer: A');
  });

  it('appends énoncé and corrigé caption blocks when figures are present', () => {
    const point = {
      id: 'p2',
      payload: {
        question_text: 'Q',
        answer_text: 'A',
        enonce_figures: [
          {
            label: 'figure 1',
            description: 'circuit RC avec condensateur 100µF',
            relpath: 'p/figures/x.png',
          },
        ],
        corrige_figures: [
          {
            label: 'figure 1',
            description: 'tracé de la tension u(t)',
            relpath: 'p/figures/y.png',
          },
        ],
      },
    };
    const passage = formatRerankPassage(point);
    expect(passage).toContain('Figures énoncé:');
    expect(passage).toContain('circuit RC');
    expect(passage).toContain('condensateur');
    expect(passage).toContain('Figures corrigé:');
    expect(passage).toContain('tension u(t)');
  });

  it('caps caption text per side so one heavy pair cannot dominate', () => {
    const big = 'a'.repeat(2000);
    const point = {
      id: 'p3',
      payload: {
        question_text: 'Q',
        answer_text: 'A',
        enonce_figures: [
          {
            label: 'figure 1',
            description: big,
            relpath: 'p/figures/x.png',
          },
        ],
      },
    };
    const passage = formatRerankPassage(point);
    // The Question/Answer/Figures structure adds prefix overhead, but
    // the énoncé caption itself must be capped to roughly 600 chars.
    const enonceLine = passage
      .split('\n')
      .find((l) => l.startsWith('Figures énoncé:'));
    expect(enonceLine).toBeDefined();
    expect(enonceLine!.length).toBeLessThan(800);
    // Truncation marker present.
    expect(enonceLine!.endsWith('…')).toBe(true);
  });
});

/**
 * Unit tests for the `lemma:` citation builders.
 *
 * Pinning the contract that every retrieval tool ships a Citation
 * block whose `inline_link` is a drop-in markdown link the agent can
 * paste verbatim into its prose. Catches: mis-parsed pair_ids,
 * missing fallbacks, encoding regressions on the URI scheme.
 */
describe('citation builders', () => {
  const PAIR_ID = 'math-2024-principale-math:ex_1:q_1.a';
  const CTX = {
    pair_id: PAIR_ID,
    matiere: 'math',
    year: 2024,
    session: 'principale',
    track: 'math',
    exercise_number: 1,
    question_number: '1.a',
  };

  describe('parsePairId', () => {
    it('destructures a v6 pair_id into exam / exercise / question handles', () => {
      const parsed = parsePairId(PAIR_ID);
      expect(parsed).toEqual({
        exam_handle: 'math-2024-principale-math',
        exercise_handle: 'ex_1',
        question_handle: 'q_1.a',
      });
    });

    it('returns null for an empty / malformed pair_id', () => {
      expect(parsePairId(null)).toBeNull();
      expect(parsePairId('')).toBeNull();
      expect(parsePairId('not-a-real-id')).toBeNull();
    });
  });

  describe('buildPairCitation', () => {
    it('produces a ref_uri, short_label, label, and inline_link', () => {
      const citation = buildPairCitation(CTX);
      expect(citation).not.toBeNull();
      expect(citation!.ref_uri).toBe(`lemma:pair:${PAIR_ID}`);
      expect(citation!.short_label).toMatch(/Bac 2024/);
      expect(citation!.short_label).toMatch(/Ex\s*1/);
      expect(citation!.short_label).toMatch(/Q1\.a/);
      expect(citation!.inline_link).toBe(
        `[${citation!.short_label}](${citation!.ref_uri})`,
      );
    });

    it('returns null when pair_id is missing', () => {
      expect(buildPairCitation({ ...CTX, pair_id: null })).toBeNull();
    });
  });

  describe('buildFigureCitation', () => {
    it('builds a 0-based fig URI keyed by side AND question handle', () => {
      // Canonical 5-segment shape — the question handle disambiguates
      // figures across pairs that share the same (exam, exercise, side,
      // index) tuple. See the doc comment on `buildFigureCitation` for
      // the why.
      const fig0 = buildFigureCitation(CTX, 'enonce', 0);
      expect(fig0).not.toBeNull();
      expect(fig0!.ref_uri).toBe(
        'lemma:fig:math-2024-principale-math:ex_1:q_1.a:enonce:0',
      );
      const fig1Corrige = buildFigureCitation(CTX, 'corrige', 1);
      expect(fig1Corrige!.ref_uri).toBe(
        'lemma:fig:math-2024-principale-math:ex_1:q_1.a:corrige:1',
      );
    });

    it('emits distinct URIs for two pairs in the same exercise', () => {
      // Regression: in the v6 corpus, different pairs in one exercise
      // can carry physically different `enonce_figures[0]` images; the
      // citation must reflect the calling pair so the resolver can
      // pick the right one.
      const fromQ1a = buildFigureCitation(CTX, 'enonce', 0);
      const fromQ3b = buildFigureCitation(
        { ...CTX, pair_id: 'math-2024-principale-math:ex_1:q_3.b' },
        'enonce',
        0,
      );
      expect(fromQ1a!.ref_uri).not.toBe(fromQ3b!.ref_uri);
      expect(fromQ3b!.ref_uri).toBe(
        'lemma:fig:math-2024-principale-math:ex_1:q_3.b:enonce:0',
      );
    });

    it('falls back to the legacy 4-segment URI when no question handle is in scope', () => {
      // Resolver-internal callsite: when rebuilding a citation for a
      // legacy URI we don't always have a question handle on hand.
      const legacy = buildFigureCitation(
        {
          exam_handle: 'math-2024-principale-math',
          exercise_handle: 'ex_1',
          matiere: 'math',
          year: 2024,
          session: 'principale',
          track: 'math',
          exercise_number: 1,
        },
        'enonce',
        0,
      );
      expect(legacy!.ref_uri).toBe(
        'lemma:fig:math-2024-principale-math:ex_1:enonce:0',
      );
    });

    it('renders 1-based figure numbers in the human label', () => {
      const fig0 = buildFigureCitation(CTX, 'enonce', 0);
      expect(fig0!.short_label).toMatch(/figure 1/);
      const fig2 = buildFigureCitation(CTX, 'enonce', 2);
      expect(fig2!.short_label).toMatch(/figure 3/);
    });

    it('returns null when pair_id is missing', () => {
      expect(
        buildFigureCitation({ ...CTX, pair_id: null }, 'enonce', 0),
      ).toBeNull();
    });
  });

  describe('buildExerciseCitation', () => {
    it('produces a lemma:exercise URI without the question handle', () => {
      const citation = buildExerciseCitation(CTX);
      expect(citation).not.toBeNull();
      expect(citation!.ref_uri).toBe(
        'lemma:exercise:math-2024-principale-math:ex_1',
      );
      expect(citation!.short_label).toMatch(/Ex\s*1/);
    });
  });

  describe('buildExamCitation', () => {
    it('uses exam_handle when provided', () => {
      const citation = buildExamCitation({
        exam_handle: 'math-2024-principale-math',
        matiere: 'math',
        year: 2024,
        session: 'principale',
        track: 'math',
      });
      expect(citation).not.toBeNull();
      expect(citation!.ref_uri).toBe('lemma:exam:math-2024-principale-math');
    });

    it('returns null when both exam_handle and pair_id are missing', () => {
      expect(
        buildExamCitation({
          exam_handle: null,
          matiere: 'math',
          year: 2024,
          session: 'principale',
          track: 'math',
        }),
      ).toBeNull();
    });
  });
});

/**
 * Unit tests for citation propagation through `formatFiguresForLLM`.
 *
 * Pinning the contract that every formatted figure carries a
 * `citation` block when called with a `pairContext`, so the agent
 * can drop the figure's `inline_link` into its prose without
 * re-deriving the URI.
 */
describe('formatFiguresForLLM (citation propagation)', () => {
  const CDN = 'https://cdn.example/ocr_omni';
  const CTX = {
    pair_id: 'math-2024-principale-math:ex_1:q_1.a',
    matiere: 'math',
    year: 2024,
    session: 'principale',
    track: 'math',
    exercise_number: 1,
    question_number: '1.a',
  };

  it('emits citation: null on each figure when no pairContext is passed', () => {
    const payload = {
      enonce_figures: [
        { label: 'figure 1', description: 'caption a', relpath: 'a.png' },
        { label: 'figure 2', description: 'caption b', relpath: 'b.png' },
      ],
      corrige_figures: [
        { label: 'figure 1', description: 'caption c', relpath: 'c.png' },
      ],
    };
    const out = formatFiguresForLLM(payload, CDN);
    expect(out.enonce.every((f) => f.citation === null)).toBe(true);
    expect(out.corrige.every((f) => f.citation === null)).toBe(true);
  });

  it('emits per-figure citations keyed by side + 0-based index', () => {
    const payload = {
      enonce_figures: [
        { label: 'figure 1', description: 'caption a', relpath: 'a.png' },
        { label: 'figure 2', description: 'caption b', relpath: 'b.png' },
      ],
      corrige_figures: [
        { label: 'figure 1', description: 'caption c', relpath: 'c.png' },
      ],
    };
    const out = formatFiguresForLLM(payload, CDN, { pairContext: CTX });
    expect(out.enonce[0].citation?.ref_uri).toBe(
      'lemma:fig:math-2024-principale-math:ex_1:q_1.a:enonce:0',
    );
    expect(out.enonce[1].citation?.ref_uri).toBe(
      'lemma:fig:math-2024-principale-math:ex_1:q_1.a:enonce:1',
    );
    expect(out.corrige[0].citation?.ref_uri).toBe(
      'lemma:fig:math-2024-principale-math:ex_1:q_1.a:corrige:0',
    );
  });
});

/**
 * Unit tests for citation propagation through `formatPairForLLM`.
 *
 * Pinning the contract that the formatted pair envelope carries a
 * top-level `citation` block AND per-figure citations, derived from
 * the Qdrant payload's `pair_id_logical` / matière / year / session
 * / track / exercise_number / question_number fields.
 */
describe('formatPairForLLM (citation propagation)', () => {
  it('emits a top-level citation block sourced from pair_id_logical', () => {
    const point = {
      id: 'p',
      score: 0.9,
      payload: {
        pair_id_logical: 'math-2024-principale-math:ex_1:q_1.a',
        matiere: 'math',
        year: 2024,
        session: 'principale',
        track: 'math',
        exercise_number: 1,
        question_number: '1.a',
        question_text: 'q',
        answer_text: 'a',
      },
    };
    const out = formatPairForLLM(point);
    expect(out.citation).not.toBeNull();
    expect((out.citation as { ref_uri: string }).ref_uri).toBe(
      'lemma:pair:math-2024-principale-math:ex_1:q_1.a',
    );
  });

  it('propagates per-figure citations alongside the pair citation', () => {
    const point = {
      id: 'p',
      score: 0.9,
      payload: {
        pair_id_logical: 'math-2024-principale-math:ex_1:q_1.a',
        matiere: 'math',
        year: 2024,
        session: 'principale',
        track: 'math',
        exercise_number: 1,
        question_number: '1.a',
        question_text: 'q',
        answer_text: 'a',
        enonce_figures: [
          { label: 'figure 1', description: 'caption a', relpath: 'a.png' },
        ],
      },
    };
    const out = formatPairForLLM(point);
    const figures = out.figures as {
      enonce: { citation: { ref_uri: string } | null }[];
      corrige: { citation: { ref_uri: string } | null }[];
    };
    expect(figures.enonce[0].citation?.ref_uri).toBe(
      'lemma:fig:math-2024-principale-math:ex_1:q_1.a:enonce:0',
    );
  });

  it('emits citation: null when pair_id_logical is missing', () => {
    const point = {
      id: 'p',
      score: 0.9,
      payload: {
        // intentionally no pair_id_logical / pair_id
        matiere: 'math',
        year: 2024,
        question_text: 'q',
        answer_text: 'a',
      },
    };
    const out = formatPairForLLM(point);
    expect(out.citation).toBeNull();
  });
});
