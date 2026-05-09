import {
  buildImageUrl,
  formatFiguresForLLM,
  formatPairForLLM,
  formatRerankPassage,
  readFigureEntries,
} from './index';

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
