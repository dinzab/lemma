import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  buildDossierFigureCitation,
  buildExamCitation,
  buildExerciseCitation,
  buildFigureCitation,
  buildPairCitation,
  type Citation,
  type CitationContext,
} from '../agent/citations';
import {
  buildImageUrl,
  formatFiguresForLLM,
  readFigureEntries,
} from '../agent/tools';
import {
  formatReferenceDocForLLM,
  readReferenceDoc,
  referenceDocKindLabel,
  type FormattedReferenceDocFigure,
} from '../agent/tools/reference-doc';
import {
  QdrantClientProvider,
  type QdrantPoint,
} from '../agent/tools/qdrant.client';

/**
 * One figure entry as returned by the resolver. Mirrors the shape the
 * conversation-scoped `<FigureRegistry>` already consumes so the
 * frontend can drop a resolved figure into the same chip surface.
 */
export interface ResolvedFigure {
  url: string | null;
  label: string;
  caption: string | null;
  side: 'enonce' | 'corrige';
  index: number;
  citation: Citation | null;
}

interface ExamMeta {
  exam_handle: string;
  exam_id: string | null;
  matiere: string | null;
  year: number | string | null;
  session: string | null;
  track: string | null;
  exam: string | null;
}

interface ExerciseMeta {
  exercise_handle: string;
  exercise_number: number | string | null;
  /** Full-exercise stitched énoncé image URL when the corpus has it. */
  exercise_enonce_image_url: string | null;
  /** Full-exercise stitched corrigé image URL when the corpus has it. */
  exercise_corrige_image_url: string | null;
  /** Whole-paper énoncé scan URL (for the open-the-source Drawer). */
  exam_full_enonce_url: string | null;
  /** Whole-paper corrigé scan URL. */
  exam_full_corrige_url: string | null;
}

export interface ResolvedFigureResponse {
  kind: 'figure';
  uri: string;
  citation: Citation | null;
  exam: ExamMeta;
  exercise: ExerciseMeta;
  figure: ResolvedFigure;
}

export interface ResolvedExerciseResponse {
  kind: 'exercise';
  uri: string;
  citation: Citation | null;
  label: string;
  short_label: string;
  exam: ExamMeta;
  exercise: ExerciseMeta;
  figures: { enonce: ResolvedFigure[]; corrige: ResolvedFigure[] };
  /** One representative pair_id under this exercise, for diagnostics. */
  pair_id: string | null;
}

export interface ResolvedPairResponse {
  kind: 'pair';
  uri: string;
  citation: Citation | null;
  exercise_citation: Citation | null;
  exam_citation: Citation | null;
  label: string;
  short_label: string;
  pair_id: string | null;
  question_number: string | null;
  question_text: string | null;
  answer_text: string | null;
  exam: ExamMeta;
  exercise: ExerciseMeta;
  figures: { enonce: ResolvedFigure[]; corrige: ResolvedFigure[] };
}

export interface ResolvedExamResponse {
  kind: 'exam';
  uri: string;
  citation: Citation | null;
  label: string;
  short_label: string;
  exam: ExamMeta;
  /** Per-exercise summary so the dialog can list exercises with figure counts. */
  exercises: Array<{
    exercise_handle: string;
    exercise_number: number | null;
    n_questions: number;
    n_enonce_figures: number;
    n_corrige_figures: number;
  }>;
  /** Whole-paper scans, identical to `ExerciseMeta.exam_full_*`. */
  exam_full_enonce_url: string | null;
  exam_full_corrige_url: string | null;
}

export interface ResolvedDossierFigureResponse {
  kind: 'dossier_figure';
  uri: string;
  citation: Citation | null;
  exam: ExamMeta;
  /** The dossier kind label (e.g. `"Dossier technique"`). */
  reference_doc_kind: string;
  reference_doc_kind_label: string;
  figure: FormattedReferenceDocFigure;
}

export type ResolvedReference =
  | ResolvedFigureResponse
  | ResolvedExerciseResponse
  | ResolvedPairResponse
  | ResolvedExamResponse
  | ResolvedDossierFigureResponse;

export class InvalidLemmaUriError extends Error {
  constructor(public readonly uri: string) {
    super(`Invalid lemma: URI "${uri}"`);
    this.name = 'InvalidLemmaUriError';
  }
}

export class LemmaUriNotFoundError extends Error {
  constructor(public readonly uri: string) {
    super(`No corpus entry resolves "${uri}"`);
    this.name = 'LemmaUriNotFoundError';
  }
}

/** Internal: parsed shape of every `lemma:` URI grammar. */
type ParsedUri =
  | {
      kind: 'figure';
      exam_handle: string;
      exercise_handle: string;
      /**
       * Present for canonical 5-segment figure URIs
       * (`lemma:fig:<exam>:<exercise>:<question>:<side>:<index>`),
       * absent for legacy 4-segment URIs persisted by older agent
       * turns. Resolvers branch on this: when present we look up the
       * exact pair via `pair_id_logical`; when absent we fall back to
       * the legacy scroll-and-pick behaviour.
       */
      question_handle: string | null;
      side: 'enonce' | 'corrige';
      index: number;
    }
  | { kind: 'exercise'; exam_handle: string; exercise_handle: string }
  | {
      kind: 'pair';
      exam_handle: string;
      exercise_handle: string;
      question_handle: string;
    }
  | { kind: 'exam'; exam_handle: string }
  | { kind: 'dossier_fig'; exam_handle: string; figure_id: string };

/**
 * Resolve `lemma:` URIs against the corpus so the frontend's inline
 * citation chips can render correctly *without* requiring the agent
 * to have already fired a tool that registered the figure / exercise
 * in the conversation.
 *
 * Without this resolver, a figure chip cited inline before the
 * matching `show_question_assets` / `get_question_pair` tool runs
 * falls back to the broken-image fallback ("figure indisponible"),
 * and a `lemma:exercise:…` chip whose exercise has no on-page
 * `<QuestionAssetsBlock>` ends up as an inert pill.
 *
 * The service is read-only — it never touches Neo4j and never writes
 * back to Qdrant; it only scrolls the v6 collection by exam_id +
 * pair_id_logical to recover the figure relpaths and exam metadata
 * the chip needs.
 */
@Injectable()
export class ReferencesService {
  private readonly logger = new Logger(ReferencesService.name);

  constructor(
    private readonly qdrant: QdrantClientProvider,
    private readonly config: ConfigService,
  ) {}

  /** Same shape as `AgentToolsService['imageCdnBase']` — exposed here so
   * the resolver builds R2 URLs that match the rest of the agent
   * surface byte-for-byte. */
  private get cdnBase(): string | undefined {
    return this.config.get<string>('R2_PUBLIC_BASE');
  }

  async resolve(uri: string): Promise<ResolvedReference> {
    const parsed = parseLemmaUri(uri);
    if (!parsed) throw new InvalidLemmaUriError(uri);

    switch (parsed.kind) {
      case 'figure':
        return this.resolveFigure(uri, parsed);
      case 'exercise':
        return this.resolveExercise(uri, parsed);
      case 'pair':
        return this.resolvePair(uri, parsed);
      case 'exam':
        return this.resolveExam(uri, parsed);
      case 'dossier_fig':
        return this.resolveDossierFigure(uri, parsed);
    }
  }

  /**
   * Resolve a `lemma:dossier_fig:<exam>:<figure_id>` URI to the
   * matching figure inside the exam's `reference_doc`. Every pair
   * in a given exam carries the same denormalised dossier on its
   * Qdrant payload, so we only need to scroll one point under the
   * exam to find the figure list.
   */
  private async resolveDossierFigure(
    uri: string,
    parsed: Extract<ParsedUri, { kind: 'dossier_fig' }>,
  ): Promise<ResolvedDossierFigureResponse> {
    const points = await this.scrollExamPairs(parsed.exam_handle);
    if (points.length === 0) throw new LemmaUriNotFoundError(uri);

    // The dossier is denormalised onto every pair, but only the
    // pairs ingested under `omni_v6.6` carry the new fields. Find
    // the first point with a populated dossier.
    let dossierPoint: QdrantPoint | null = null;
    for (const p of points) {
      if (readReferenceDoc(p.payload) !== null) {
        dossierPoint = p;
        break;
      }
    }
    if (!dossierPoint) throw new LemmaUriNotFoundError(uri);

    const raw = readReferenceDoc(dossierPoint.payload);
    if (!raw) throw new LemmaUriNotFoundError(uri);

    const formatted = formatReferenceDocForLLM(raw, {
      cdnBase: this.cdnBase,
      examHandle: parsed.exam_handle,
    });
    const figure = formatted.figures.find((f) => f.id === parsed.figure_id);
    if (!figure) throw new LemmaUriNotFoundError(uri);

    const meta = readMetaFromPoint(dossierPoint, parsed.exam_handle, null);
    return {
      kind: 'dossier_figure',
      uri,
      citation:
        figure.citation ??
        buildDossierFigureCitation({
          exam_handle: parsed.exam_handle,
          figure_id: parsed.figure_id,
          label: figure.label,
          kind: formatted.kind,
        }),
      exam: meta.exam,
      reference_doc_kind: formatted.kind,
      reference_doc_kind_label: referenceDocKindLabel(formatted.kind),
      figure,
    };
  }

  private async resolveFigure(
    uri: string,
    parsed: Extract<ParsedUri, { kind: 'figure' }>,
  ): Promise<ResolvedFigureResponse> {
    let targetPoint: QdrantPoint | null = null;
    let targetEntries: ReturnType<typeof readFigureEntries> = [];

    if (parsed.question_handle) {
      // Canonical 5-segment shape: look up the exact pair so we always
      // surface the figure the agent actually saw, not whichever pair
      // happens to scroll first under this (exam, exercise).
      const pairId = `${parsed.exam_handle}:${parsed.exercise_handle}:${parsed.question_handle}`;
      const point = await this.qdrant.getByPairId(pairId);
      if (point) {
        const entries = readFigureEntries(point.payload, parsed.side);
        if (entries.length > parsed.index) {
          targetPoint = point;
          targetEntries = entries;
        }
      }
    }

    if (!targetPoint) {
      // Legacy 4-segment shape (or 5-segment with a stale pair_id):
      // scroll the exercise and pick the first pair whose figures array
      // is long enough. Predates the v6 cutover; behaviour matches the
      // chip the user already saw before this fix shipped.
      const points = await this.scrollExercisePairs(
        parsed.exam_handle,
        parsed.exercise_handle,
      );
      if (points.length === 0) throw new LemmaUriNotFoundError(uri);
      for (const p of points) {
        const entries = readFigureEntries(p.payload, parsed.side);
        if (entries.length > parsed.index) {
          targetPoint = p;
          targetEntries = entries;
          break;
        }
      }
    }

    if (!targetPoint || targetEntries.length === 0) {
      throw new LemmaUriNotFoundError(uri);
    }

    const figEntry = targetEntries[parsed.index];
    if (!figEntry) throw new LemmaUriNotFoundError(uri);

    const meta = readMetaFromPoint(
      targetPoint,
      parsed.exam_handle,
      parsed.exercise_handle,
    );
    const ctx: CitationContext = {
      ...citationContextFromMeta(meta),
      // Carry the question handle through so the rebuilt citation
      // emits the same canonical 5-segment URI the chip sent in.
      // Falls back to whatever the payload exposes (preserves the
      // legacy behaviour for 4-segment URIs whose pair we picked
      // by scroll order).
      question_handle:
        parsed.question_handle ??
        (typeof targetPoint.payload?.question_number === 'string'
          ? `q_${targetPoint.payload.question_number as string}`
          : null),
    };
    const figure: ResolvedFigure = {
      url: buildImageUrl(figEntry.relpath, this.cdnBase),
      label: figEntry.label,
      caption: figEntry.description,
      side: parsed.side,
      index: parsed.index,
      citation: buildFigureCitation(ctx, parsed.side, parsed.index),
    };
    return {
      kind: 'figure',
      uri,
      citation: figure.citation,
      exam: meta.exam,
      exercise: this.exerciseMetaFromPayload(targetPoint, meta.exercise),
      figure,
    };
  }

  private async resolveExercise(
    uri: string,
    parsed: Extract<ParsedUri, { kind: 'exercise' }>,
  ): Promise<ResolvedExerciseResponse> {
    const points = await this.scrollExercisePairs(
      parsed.exam_handle,
      parsed.exercise_handle,
    );
    if (points.length === 0) throw new LemmaUriNotFoundError(uri);

    // Pick the pair that carries the most figure assets — fall back to
    // the lowest question handle when nobody has any, so we still
    // surface meaningful exam metadata.
    const seedPoint = pickRichestPoint(points) ?? points[0];
    const meta = readMetaFromPoint(
      seedPoint,
      parsed.exam_handle,
      parsed.exercise_handle,
    );
    const ctx = citationContextFromMeta(meta);
    const figures = formatFiguresForLLM(seedPoint.payload, this.cdnBase, {
      full: true,
      pairContext: ctx,
    });
    const citation = buildExerciseCitation(ctx);
    return {
      kind: 'exercise',
      uri,
      citation,
      label:
        citation?.label ??
        `Exercice ${meta.exercise.exercise_number ?? ''}`.trim(),
      short_label:
        citation?.short_label ?? citation?.label ?? parsed.exercise_handle,
      exam: meta.exam,
      exercise: this.exerciseMetaFromPayload(seedPoint, meta.exercise),
      figures: {
        enonce: figures.enonce.map((f, idx) => ({
          url: f.url,
          label: f.label,
          caption: f.caption,
          side: 'enonce',
          index: idx,
          citation: f.citation,
        })),
        corrige: figures.corrige.map((f, idx) => ({
          url: f.url,
          label: f.label,
          caption: f.caption,
          side: 'corrige',
          index: idx,
          citation: f.citation,
        })),
      },
      pair_id:
        typeof seedPoint.payload?.pair_id_logical === 'string'
          ? (seedPoint.payload.pair_id_logical as string)
          : typeof seedPoint.payload?.pair_id === 'string'
            ? (seedPoint.payload.pair_id as string)
            : null,
    };
  }

  private async resolvePair(
    uri: string,
    parsed: Extract<ParsedUri, { kind: 'pair' }>,
  ): Promise<ResolvedPairResponse> {
    const targetPairId = `${parsed.exam_handle}:${parsed.exercise_handle}:${parsed.question_handle}`;
    const point = await this.qdrant.getByPairId(targetPairId);
    if (!point) throw new LemmaUriNotFoundError(uri);

    const meta = readMetaFromPoint(
      point,
      parsed.exam_handle,
      parsed.exercise_handle,
    );
    const ctx: CitationContext = {
      ...citationContextFromMeta(meta),
      question_handle: parsed.question_handle,
      question_number:
        typeof point.payload?.question_number === 'string'
          ? (point.payload.question_number as string)
          : null,
    };
    const figures = formatFiguresForLLM(point.payload, this.cdnBase, {
      full: true,
      pairContext: ctx,
    });
    const citation = buildPairCitation(ctx);
    const exerciseCitation = buildExerciseCitation(ctx);
    const examCitation = buildExamCitation({
      exam_handle: meta.exam.exam_handle,
      matiere: meta.exam.matiere,
      year: meta.exam.year,
      session: meta.exam.session,
      track: meta.exam.track,
    });
    const payload = (point.payload ?? {}) as Record<string, unknown>;
    return {
      kind: 'pair',
      uri,
      citation,
      exercise_citation: exerciseCitation,
      exam_citation: examCitation,
      label: citation?.label ?? targetPairId,
      short_label: citation?.short_label ?? citation?.label ?? targetPairId,
      pair_id:
        typeof payload.pair_id_logical === 'string'
          ? (payload.pair_id_logical as string)
          : typeof payload.pair_id === 'string'
            ? (payload.pair_id as string)
            : targetPairId,
      question_number:
        typeof payload.question_number === 'string'
          ? (payload.question_number as string)
          : null,
      question_text:
        typeof payload.question_text === 'string'
          ? (payload.question_text as string)
          : null,
      answer_text:
        typeof payload.answer_text === 'string'
          ? (payload.answer_text as string)
          : null,
      exam: meta.exam,
      exercise: this.exerciseMetaFromPayload(point, meta.exercise),
      figures: {
        enonce: figures.enonce.map((f, idx) => ({
          url: f.url,
          label: f.label,
          caption: f.caption,
          side: 'enonce',
          index: idx,
          citation: f.citation,
        })),
        corrige: figures.corrige.map((f, idx) => ({
          url: f.url,
          label: f.label,
          caption: f.caption,
          side: 'corrige',
          index: idx,
          citation: f.citation,
        })),
      },
    };
  }

  private async resolveExam(
    uri: string,
    parsed: Extract<ParsedUri, { kind: 'exam' }>,
  ): Promise<ResolvedExamResponse> {
    const points = await this.scrollExamPairs(parsed.exam_handle);
    if (points.length === 0) throw new LemmaUriNotFoundError(uri);
    // Group by exercise_number so the dialog can list exercises.
    const byExercise = new Map<number, QdrantPoint[]>();
    for (const p of points) {
      const exNum = readExerciseNumber(p);
      if (exNum === null) continue;
      const arr = byExercise.get(exNum) ?? [];
      arr.push(p);
      byExercise.set(exNum, arr);
    }
    const seedPoint = points[0];
    const meta = readMetaFromPoint(seedPoint, parsed.exam_handle, null);
    const citation = buildExamCitation({
      exam_handle: parsed.exam_handle,
      matiere: meta.exam.matiere,
      year: meta.exam.year,
      session: meta.exam.session,
      track: meta.exam.track,
    });
    const exercises = [...byExercise.entries()]
      .map(([exNum, pts]) => {
        let nEnonceFig = 0;
        let nCorrigeFig = 0;
        for (const p of pts) {
          nEnonceFig += readFigureEntries(p.payload, 'enonce').length;
          nCorrigeFig += readFigureEntries(p.payload, 'corrige').length;
        }
        return {
          exercise_handle: `ex_${exNum}`,
          exercise_number: exNum,
          n_questions: pts.length,
          n_enonce_figures: nEnonceFig,
          n_corrige_figures: nCorrigeFig,
        };
      })
      .sort((a, b) => a.exercise_number - b.exercise_number);
    const examFullEnonce = buildImageUrl(
      readStringPayload(seedPoint, 'exam_full_enonce_relpath'),
      this.cdnBase,
    );
    const examFullCorrige = buildImageUrl(
      readStringPayload(seedPoint, 'exam_full_corrige_relpath'),
      this.cdnBase,
    );
    return {
      kind: 'exam',
      uri,
      citation,
      label: citation?.label ?? parsed.exam_handle,
      short_label:
        citation?.short_label ?? citation?.label ?? parsed.exam_handle,
      exam: meta.exam,
      exercises,
      exam_full_enonce_url: examFullEnonce,
      exam_full_corrige_url: examFullCorrige,
    };
  }

  /** Build the `ExerciseMeta` block from a Qdrant point's payload. */
  private exerciseMetaFromPayload(
    point: QdrantPoint,
    base: ExerciseMeta,
  ): ExerciseMeta {
    return {
      ...base,
      exercise_enonce_image_url: buildImageUrl(
        readStringPayload(point, 'exercise_enonce_image_relpath'),
        this.cdnBase,
      ),
      exercise_corrige_image_url: buildImageUrl(
        readStringPayload(point, 'exercise_corrige_image_relpath'),
        this.cdnBase,
      ),
      exam_full_enonce_url: buildImageUrl(
        readStringPayload(point, 'exam_full_enonce_relpath'),
        this.cdnBase,
      ),
      exam_full_corrige_url: buildImageUrl(
        readStringPayload(point, 'exam_full_corrige_relpath'),
        this.cdnBase,
      ),
    };
  }

  /** Scroll every Qdrant point under one exam handle. */
  private async scrollExamPairs(examHandle: string): Promise<QdrantPoint[]> {
    // exam_id is the canonical v6 keyword-indexed handle; exam is the
    // legacy v1 underscored fallback (mirrors list_exam_questions).
    let points = await this.qdrant.scrollByFilter({
      filter: { must: [{ key: 'exam_id', match: { value: examHandle } }] },
      limit: SCROLL_CAP,
    });
    if (points.length === 0) {
      points = await this.qdrant.scrollByFilter({
        filter: { must: [{ key: 'exam', match: { value: examHandle } }] },
        limit: SCROLL_CAP,
      });
    }
    return points;
  }

  /** Scroll only the pairs under one exam + one exercise. */
  private async scrollExercisePairs(
    examHandle: string,
    exerciseHandle: string,
  ): Promise<QdrantPoint[]> {
    const exNum = exerciseNumberFromHandle(exerciseHandle);
    if (exNum === null) return [];
    const all = await this.scrollExamPairs(examHandle);
    return all.filter((p) => readExerciseNumber(p) === exNum);
  }
}

const SCROLL_CAP = 200;

interface PointMeta {
  exam: ExamMeta;
  exercise: ExerciseMeta;
}

/** Read the canonical `<exam_handle>:<exercise_handle>` metadata block
 * from one Qdrant point's payload. Falls back to the URI handles so
 * the citation builders never see a missing exam_handle. */
function readMetaFromPoint(
  point: QdrantPoint,
  examHandleFromUri: string,
  exerciseHandleFromUri: string | null,
): PointMeta {
  const payload = (point.payload ?? {}) as Record<string, unknown>;
  const examFromPayload =
    typeof payload.exam_id === 'string'
      ? (payload.exam_id as string)
      : examHandleFromUri;
  const exerciseNumber =
    typeof payload.exercise_number === 'number'
      ? (payload.exercise_number as number)
      : null;
  const exerciseHandle =
    exerciseHandleFromUri ??
    (exerciseNumber !== null ? `ex_${exerciseNumber}` : 'ex_?');
  return {
    exam: {
      exam_handle: examFromPayload,
      exam_id:
        typeof payload.exam_id === 'string'
          ? (payload.exam_id as string)
          : null,
      matiere:
        typeof payload.matiere === 'string'
          ? (payload.matiere as string)
          : null,
      year:
        typeof payload.year === 'number' || typeof payload.year === 'string'
          ? (payload.year as number | string)
          : typeof payload.exam_year === 'number' ||
              typeof payload.exam_year === 'string'
            ? (payload.exam_year as number | string)
            : null,
      session:
        typeof payload.session === 'string'
          ? (payload.session as string)
          : null,
      track:
        typeof payload.track === 'string'
          ? (payload.track as string)
          : typeof payload.filiere === 'string'
            ? (payload.filiere as string)
            : null,
      exam: typeof payload.exam === 'string' ? (payload.exam as string) : null,
    },
    exercise: {
      exercise_handle: exerciseHandle,
      exercise_number: exerciseNumber,
      exercise_enonce_image_url: null,
      exercise_corrige_image_url: null,
      exam_full_enonce_url: null,
      exam_full_corrige_url: null,
    },
  };
}

/** Build a `CitationContext` from the resolver's `PointMeta` so the
 * citation builders see the same shape as `formatPairForLLM`. */
function citationContextFromMeta(meta: PointMeta): CitationContext {
  return {
    exam_handle: meta.exam.exam_handle,
    exercise_handle: meta.exercise.exercise_handle,
    matiere: meta.exam.matiere,
    year: meta.exam.year,
    session: meta.exam.session,
    track: meta.exam.track,
    exercise_number: meta.exercise.exercise_number,
  };
}

/** Pick the Qdrant point with the most figure entries — handy for the
 * exercise-resolver, which needs the richest payload to build the
 * dialog body. */
function pickRichestPoint(points: QdrantPoint[]): QdrantPoint | null {
  if (points.length === 0) return null;
  let best = points[0];
  let bestScore = scoreFigures(best);
  for (const p of points.slice(1)) {
    const s = scoreFigures(p);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

function scoreFigures(point: QdrantPoint): number {
  return (
    readFigureEntries(point.payload, 'enonce').length +
    readFigureEntries(point.payload, 'corrige').length
  );
}

function readExerciseNumber(point: QdrantPoint): number | null {
  const v = (point.payload ?? {}).exercise_number;
  return typeof v === 'number' ? v : null;
}

function readStringPayload(point: QdrantPoint, key: string): string | null {
  const v = (point.payload ?? {})[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function exerciseNumberFromHandle(handle: string): number | null {
  const m = /^ex_(\d+)$/.exec(handle);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a `lemma:` URI into a typed shape. Returns `null` for
 * malformed input so the controller can surface a 400 to the
 * caller.
 *
 * Grammar (mirrors the system-prompt + citation builder):
 *   lemma:fig:<exam>:<exercise>:<side>:<index>
 *   lemma:exercise:<exam>:<exercise>
 *   lemma:pair:<exam>:<exercise>:<question>
 *   lemma:exam:<exam>
 *
 * `exam` is the v6 hyphenated handle (no colons); `exercise` is
 * `ex_<n>`; `question` is `q_<digits[.letter]>`. We're permissive on
 * the `question` shape so a future grammar tweak doesn't silently
 * reject existing chips.
 */
function parseLemmaUri(uri: string): ParsedUri | null {
  if (typeof uri !== 'string') return null;
  if (!uri.startsWith('lemma:')) return null;

  if (uri.startsWith('lemma:fig:')) {
    const rest = uri.slice('lemma:fig:'.length);
    const parts = rest.split(':');
    // Two accepted shapes:
    //   5-segment (canonical): exam : exercise : question : side : index
    //   4-segment (legacy):    exam : exercise : side : index
    // Both end in `:<side>:<index>`, so we peel those off the right and
    // inspect what remains. The middle slot is a question handle when
    // it starts with `q_` (the v6 convention) and an exercise handle
    // when it starts with `ex_` — that lets us tell the two shapes
    // apart even though they share the same total component count for
    // some malformed inputs.
    if (parts.length < 4) return null;
    const idxRaw = parts[parts.length - 1];
    const sideRaw = parts[parts.length - 2];
    if (sideRaw !== 'enonce' && sideRaw !== 'corrige') return null;
    const index = Number.parseInt(idxRaw, 10);
    if (!Number.isFinite(index) || index < 0) return null;
    // Tail is `<side>:<index>`. The slot just before that is either an
    // exercise handle (legacy 4-segment) or a question handle (canonical
    // 5-segment). Prefer the canonical reading when the third-from-last
    // slot is `ex_*`: that means we have <exam...>:<exercise>:<question>:<side>:<index>.
    const tailSlot = parts[parts.length - 3];
    const slotBeforeTail = parts.length >= 5 ? parts[parts.length - 4] : null;
    let examHandle: string;
    let exerciseHandle: string;
    let questionHandle: string | null = null;
    if (
      slotBeforeTail !== null &&
      /^ex_/.test(slotBeforeTail) &&
      tailSlot.length > 0
    ) {
      // Canonical 5-segment: tailSlot is the question handle.
      questionHandle = tailSlot;
      exerciseHandle = slotBeforeTail;
      examHandle = parts.slice(0, parts.length - 4).join(':');
    } else {
      // Legacy 4-segment: tailSlot is the exercise handle.
      exerciseHandle = tailSlot;
      examHandle = parts.slice(0, parts.length - 3).join(':');
    }
    if (!examHandle || !exerciseHandle) return null;
    return {
      kind: 'figure',
      exam_handle: examHandle,
      exercise_handle: exerciseHandle,
      question_handle: questionHandle,
      side: sideRaw,
      index,
    };
  }

  if (uri.startsWith('lemma:exercise:')) {
    const rest = uri.slice('lemma:exercise:'.length);
    const parts = rest.split(':');
    if (parts.length < 2) return null;
    const exerciseHandle = parts[parts.length - 1];
    const examHandle = parts.slice(0, parts.length - 1).join(':');
    if (!examHandle || !exerciseHandle) return null;
    return {
      kind: 'exercise',
      exam_handle: examHandle,
      exercise_handle: exerciseHandle,
    };
  }

  if (uri.startsWith('lemma:pair:')) {
    const rest = uri.slice('lemma:pair:'.length);
    const parts = rest.split(':');
    if (parts.length < 3) return null;
    // The exam handle may contain hyphens but no colons in v6, so we
    // peel the question + exercise handles off the right and treat
    // everything else as the exam handle.
    const questionHandle = parts[parts.length - 1];
    const exerciseHandle = parts[parts.length - 2];
    const examHandle = parts.slice(0, parts.length - 2).join(':');
    if (!examHandle || !exerciseHandle || !questionHandle) return null;
    return {
      kind: 'pair',
      exam_handle: examHandle,
      exercise_handle: exerciseHandle,
      question_handle: questionHandle,
    };
  }

  if (uri.startsWith('lemma:exam:')) {
    const rest = uri.slice('lemma:exam:'.length);
    if (!rest) return null;
    return { kind: 'exam', exam_handle: rest };
  }

  if (uri.startsWith('lemma:dossier_fig:')) {
    const rest = uri.slice('lemma:dossier_fig:'.length);
    const parts = rest.split(':');
    // The exam handle has no colons (matches v6 grammar); figure_id
    // is one trailing segment with no colons either. Anything more
    // is malformed.
    if (parts.length !== 2) return null;
    const [examHandle, figureId] = parts;
    if (!examHandle || !figureId) return null;
    return {
      kind: 'dossier_fig',
      exam_handle: examHandle,
      figure_id: figureId,
    };
  }

  return null;
}

/** Test-only export: lets the spec verify URI parsing without going
 * through the controller / Qdrant client. */
export const __testing__ = { parseLemmaUri };
