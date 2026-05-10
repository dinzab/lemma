import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import {
  __testing__,
  InvalidLemmaUriError,
  LemmaUriNotFoundError,
  ReferencesService,
} from './references.service';
import { QdrantClientProvider } from '../agent/tools/qdrant.client';
import type { QdrantPoint } from '../agent/tools/qdrant.client';

const { parseLemmaUri } = __testing__;

/**
 * Hand-crafted Qdrant payload mirroring the v6 shape we probed against
 * the live cluster while diagnosing the broken-figure / dead-exercise
 * citation chips. We keep the mock here (instead of a fixture file) so
 * the test file is the one source of truth for the resolver contract.
 */
const ex1Point: QdrantPoint = {
  id: 'p1',
  payload: {
    pair_id_logical: 'math-2024-principale-sciences-ex:ex_1:q_1.a',
    exam_id: 'math-2024-principale-sciences-ex',
    exam: '2024_principale_sciences_ex_math',
    matiere: 'math',
    year: 2024,
    session: 'principale',
    track: 'sciences-ex',
    exercise_number: 1,
    question_number: '1.a',
    question_text: 'énoncé Q1.a',
    answer_text: 'corrigé Q1.a',
    enonce_figures: [
      {
        label: 'Figure 1',
        description: 'graphe de la fonction f',
        relpath: '2024_principale_sciences_ex_math/figures/enonce_p0_f1.png',
      },
    ],
    corrige_figures: [],
    exercise_enonce_image_relpath:
      '2024_principale_sciences_ex_math/exercises/ex_1_enonce.png',
    exam_full_enonce_relpath:
      '2024_principale_sciences_ex_math/exam/full_enonce.png',
  },
};

const ex2Point: QdrantPoint = {
  id: 'p2',
  payload: {
    pair_id_logical: 'math-2024-principale-sciences-ex:ex_2:q_1.b',
    exam_id: 'math-2024-principale-sciences-ex',
    matiere: 'math',
    year: 2024,
    session: 'principale',
    track: 'sciences-ex',
    exercise_number: 2,
    question_number: '1.b',
    enonce_figures: [],
    corrige_figures: [],
  },
};

class FakeQdrant {
  scrolled: { exam_id: string; legacy: boolean } | null = null;

  // Exposed so spec can flip the legacy fallback path on/off.
  exposeLegacy = false;

  async scrollByFilter(opts: {
    filter: { must: Array<{ key: string; match: { value: string } }> };
  }): Promise<QdrantPoint[]> {
    const cond = opts.filter.must[0];
    if (cond.key === 'exam_id' && !this.exposeLegacy) {
      this.scrolled = { exam_id: cond.match.value, legacy: false };
      if (cond.match.value === 'math-2024-principale-sciences-ex') {
        return [ex1Point, ex2Point];
      }
      return [];
    }
    if (cond.key === 'exam' && this.exposeLegacy) {
      this.scrolled = { exam_id: cond.match.value, legacy: true };
      return [];
    }
    return [];
  }

  async getByPairId(pairId: string): Promise<QdrantPoint | null> {
    if (pairId === 'math-2024-principale-sciences-ex:ex_1:q_1.a') {
      return ex1Point;
    }
    return null;
  }
}

describe('parseLemmaUri', () => {
  it('parses lemma:fig:<exam>:<ex>:<side>:<index>', () => {
    expect(
      parseLemmaUri('lemma:fig:math-2024-principale-sciences-ex:ex_1:enonce:0'),
    ).toEqual({
      kind: 'figure',
      exam_handle: 'math-2024-principale-sciences-ex',
      exercise_handle: 'ex_1',
      side: 'enonce',
      index: 0,
    });
  });

  it('parses lemma:exercise:<exam>:<ex>', () => {
    expect(
      parseLemmaUri('lemma:exercise:math-2024-principale-sciences-ex:ex_1'),
    ).toEqual({
      kind: 'exercise',
      exam_handle: 'math-2024-principale-sciences-ex',
      exercise_handle: 'ex_1',
    });
  });

  it('parses lemma:pair:<exam>:<ex>:<q>', () => {
    expect(
      parseLemmaUri('lemma:pair:math-2024-principale-sciences-ex:ex_1:q_1.a'),
    ).toEqual({
      kind: 'pair',
      exam_handle: 'math-2024-principale-sciences-ex',
      exercise_handle: 'ex_1',
      question_handle: 'q_1.a',
    });
  });

  it('parses lemma:exam:<exam>', () => {
    expect(
      parseLemmaUri('lemma:exam:math-2024-principale-sciences-ex'),
    ).toEqual({
      kind: 'exam',
      exam_handle: 'math-2024-principale-sciences-ex',
    });
  });

  it('rejects malformed URIs', () => {
    expect(parseLemmaUri('lemma:bogus:foo')).toBeNull();
    expect(parseLemmaUri('lemma:fig:exam:ex_1:enonce:not-an-int')).toBeNull();
    expect(parseLemmaUri('lemma:fig:exam:ex_1:bogus_side:0')).toBeNull();
    expect(parseLemmaUri('lemma:fig:exam:ex_1:enonce:-1')).toBeNull();
    expect(parseLemmaUri('not-a-lemma-uri')).toBeNull();
    expect(parseLemmaUri('')).toBeNull();
  });
});

describe('ReferencesService', () => {
  let service: ReferencesService;
  let qdrant: FakeQdrant;

  beforeEach(async () => {
    qdrant = new FakeQdrant();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReferencesService,
        { provide: QdrantClientProvider, useValue: qdrant },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'R2_PUBLIC_BASE') return 'https://x.r2.dev';
              return undefined;
            },
          },
        },
      ],
    }).compile();
    service = moduleRef.get(ReferencesService);
  });

  it('throws InvalidLemmaUriError for bogus input', async () => {
    await expect(service.resolve('not-a-lemma-uri')).rejects.toBeInstanceOf(
      InvalidLemmaUriError,
    );
  });

  it('resolves a figure to a fully-qualified R2 URL', async () => {
    const out = await service.resolve(
      'lemma:fig:math-2024-principale-sciences-ex:ex_1:enonce:0',
    );
    expect(out.kind).toBe('figure');
    if (out.kind !== 'figure') return; // narrow
    expect(out.figure.url).toBe(
      'https://x.r2.dev/ocr_omni/2024_principale_sciences_ex_math/figures/enonce_p0_f1.png',
    );
    expect(out.figure.label).toBe('Figure 1');
    expect(out.figure.caption).toBe('graphe de la fonction f');
    expect(out.figure.side).toBe('enonce');
    expect(out.figure.index).toBe(0);
    expect(out.figure.citation?.ref_uri).toBe(
      'lemma:fig:math-2024-principale-sciences-ex:ex_1:enonce:0',
    );
    expect(out.exam.exam_handle).toBe('math-2024-principale-sciences-ex');
    expect(out.exercise.exercise_number).toBe(1);
    expect(out.exercise.exam_full_enonce_url).toBe(
      'https://x.r2.dev/ocr_omni/2024_principale_sciences_ex_math/exam/full_enonce.png',
    );
  });

  it('throws LemmaUriNotFoundError for an out-of-range figure index', async () => {
    await expect(
      service.resolve(
        'lemma:fig:math-2024-principale-sciences-ex:ex_1:enonce:99',
      ),
    ).rejects.toBeInstanceOf(LemmaUriNotFoundError);
  });

  it('resolves an exercise into its full asset block', async () => {
    const out = await service.resolve(
      'lemma:exercise:math-2024-principale-sciences-ex:ex_1',
    );
    expect(out.kind).toBe('exercise');
    if (out.kind !== 'exercise') return;
    expect(out.exam.exam_handle).toBe('math-2024-principale-sciences-ex');
    expect(out.exercise.exercise_handle).toBe('ex_1');
    expect(out.exercise.exercise_number).toBe(1);
    expect(out.figures.enonce.length).toBe(1);
    expect(out.figures.enonce[0].url).toBe(
      'https://x.r2.dev/ocr_omni/2024_principale_sciences_ex_math/figures/enonce_p0_f1.png',
    );
    expect(out.figures.corrige.length).toBe(0);
    expect(out.short_label).toContain('Bac');
    expect(out.exercise.exercise_enonce_image_url).toBe(
      'https://x.r2.dev/ocr_omni/2024_principale_sciences_ex_math/exercises/ex_1_enonce.png',
    );
  });

  it('resolves a pair to question+answer text and figures', async () => {
    const out = await service.resolve(
      'lemma:pair:math-2024-principale-sciences-ex:ex_1:q_1.a',
    );
    expect(out.kind).toBe('pair');
    if (out.kind !== 'pair') return;
    expect(out.question_text).toBe('énoncé Q1.a');
    expect(out.answer_text).toBe('corrigé Q1.a');
    expect(out.pair_id).toBe('math-2024-principale-sciences-ex:ex_1:q_1.a');
    expect(out.figures.enonce[0].url).toContain('enonce_p0_f1.png');
    expect(out.exercise_citation?.ref_uri).toBe(
      'lemma:exercise:math-2024-principale-sciences-ex:ex_1',
    );
    expect(out.exam_citation?.ref_uri).toBe(
      'lemma:exam:math-2024-principale-sciences-ex',
    );
  });

  it('resolves an exam into its per-exercise summary', async () => {
    const out = await service.resolve(
      'lemma:exam:math-2024-principale-sciences-ex',
    );
    expect(out.kind).toBe('exam');
    if (out.kind !== 'exam') return;
    expect(out.exercises.map((e) => e.exercise_number)).toEqual([1, 2]);
    expect(out.exercises[0].n_enonce_figures).toBe(1);
    expect(out.exercises[1].n_enonce_figures).toBe(0);
    expect(out.exam.exam_handle).toBe('math-2024-principale-sciences-ex');
  });

  it('returns a dead-letter 404 when no points match the exam handle', async () => {
    await expect(
      service.resolve('lemma:exercise:math-9999-bogus:ex_1'),
    ).rejects.toBeInstanceOf(LemmaUriNotFoundError);
  });
});
