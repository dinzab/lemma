/**
 * Citation builders for the `lemma:` URI scheme — the canonical way
 * the agent embeds inline references to past-paper questions, figures,
 * exercises, and exams in its prose. Every retrieval-shaped tool
 * (`search_questions`, `get_question_pair`, `show_question_assets`,
 * `find_similar_questions`, `list_exam_questions`, `list_exams`,
 * `inspect_figure`) attaches one of these blocks to its result so the
 * agent never has to hand-assemble a citation string from raw fields.
 *
 * The frontend (`MessageResponse` in `components/ai-elements/message.tsx`)
 * intercepts links whose `href` starts with `lemma:` and renders them
 * as inline chips that scroll to the matching `<QuestionCard>` /
 * `<PastPaperChip>` already on the page (or, for figures, pop a
 * thumbnail / lightbox sourced from the per-conversation
 * `<FigureRegistry>`).
 *
 * URI grammar:
 *   lemma:pair:<exam_handle>:<exercise_handle>:<question_handle>
 *   lemma:fig:<exam_handle>:<exercise_handle>:<side>:<index_zero_based>
 *   lemma:exercise:<exam_handle>:<exercise_handle>
 *   lemma:exam:<exam_handle>
 *
 * Where `exam_handle` is the v6 hyphenated form
 * (`<matiere>-<year>-<session>-<filiere>`, e.g.
 * `math-2024-principale-math`), `exercise_handle` is `ex_<n>`, and
 * `question_handle` is `q_<n>.<a>` (matches the v6 pair_id
 * convention). `side` is `enonce` | `corrige`.
 *
 * The block's `inline_link` field is the recommended drop-in form —
 * the agent can paste it verbatim into prose for a working citation.
 * The agent is also free to keep `ref_uri` and use a different label
 * if the surrounding prose calls for it (e.g. "ce passage" instead of
 * the long form).
 */

/**
 * One citation handle. Surfaced to the agent as JSON; the agent reads
 * `inline_link` (drop-in markdown) or `ref_uri` + a freeform label.
 */
export interface Citation {
  /** The canonical `lemma:` URI handle. */
  ref_uri: string;
  /** Short human-readable label, suitable for inline prose. */
  short_label: string;
  /** Long human-readable label, for tooltip / aria-label. */
  label: string;
  /** Drop-in markdown link the agent can paste verbatim. */
  inline_link: string;
}

/**
 * Parse a v6 pair_id into its component handles.
 *
 *   "math-2024-principale-math:ex_1:q_1.a"
 *     → {
 *         exam_handle:     "math-2024-principale-math",
 *         exercise_handle: "ex_1",
 *         question_handle: "q_1.a",
 *       }
 *
 * Returns `null` for malformed input so callers can fall back to
 * payload-derived handles.
 */
export function parsePairId(pairId: unknown): {
  exam_handle: string;
  exercise_handle: string;
  question_handle: string;
} | null {
  if (typeof pairId !== 'string' || pairId.length === 0) return null;
  const parts = pairId.split(':');
  if (parts.length < 3) return null;
  const [exam_handle, exercise_handle, ...rest] = parts;
  const question_handle = rest.join(':');
  if (!exam_handle || !exercise_handle || !question_handle) return null;
  return { exam_handle, exercise_handle, question_handle };
}

/**
 * Strip the `ex_` prefix from an exercise handle and return the
 * 1-based number string for human-readable labels. Falls back to the
 * raw handle if it doesn't match the convention.
 */
export function exerciseNumberFromHandle(handle: string | undefined): string {
  if (!handle) return '';
  const m = /^ex_(.+)$/.exec(handle);
  return m ? m[1] : handle;
}

/**
 * Strip the `q_` prefix from a question handle. e.g. `q_1.a` → `1.a`.
 */
export function questionNumberFromHandle(handle: string | undefined): string {
  if (!handle) return '';
  const m = /^q_(.+)$/.exec(handle);
  return m ? m[1] : handle;
}

/**
 * Best-effort French short label for a matière code. Falls back to a
 * Title-cased version of the code when the matière isn't in the
 * known set. Used for citation labels — never thrown at the student.
 */
export function matiereLabel(matiere: unknown): string {
  if (typeof matiere !== 'string') return '';
  const map: Record<string, string> = {
    math: 'Math',
    physique: 'Physique',
    svt: 'SVT',
    gestion: 'Gestion',
    technique: 'Technique',
    bd: 'BD',
    economie: 'Économie',
    info: 'Informatique',
    algorithme: 'Algorithme',
    francais: 'Français',
    anglais: 'Anglais',
  };
  return map[matiere] ?? matiere.charAt(0).toUpperCase() + matiere.slice(1);
}

/**
 * Compose `Bac <year> <session>` (e.g. `Bac 2024 principale`) from
 * the metadata fields commonly present on Qdrant payloads / Neo4j
 * exam nodes. Either field may be absent — the function returns the
 * tightest non-empty substring it can build, never an empty string
 * when at least one piece is known.
 */
export function bacShortLabel(opts: {
  year?: number | string | null;
  session?: string | null;
}): string {
  const pieces: string[] = ['Bac'];
  if (opts.year !== null && opts.year !== undefined && String(opts.year)) {
    pieces.push(String(opts.year));
  }
  if (opts.session) pieces.push(String(opts.session));
  return pieces.length > 1 ? pieces.join(' ') : 'Bac';
}

/**
 * Inputs a citation builder needs to label a pair / figure / exercise
 * / exam without re-querying the data store. Mirrors the subset of
 * `formatPairForLLM`'s output the agent ends up consuming for
 * citation purposes.
 */
export interface CitationContext {
  pair_id?: string | null;
  exam_handle?: string | null;
  exercise_handle?: string | null;
  question_handle?: string | null;
  matiere?: string | null;
  year?: number | string | null;
  session?: string | null;
  track?: string | null;
  exercise_number?: number | string | null;
  question_number?: string | null;
}

/** Resolve `exam_handle` / `exercise_handle` / `question_handle` from
 * a CitationContext, parsing the pair_id when explicit handles are
 * absent. Returns `null` when neither form yields a usable handle —
 * citation builders return `null` in that case so the caller can
 * decide whether to drop the citation or fall back to plain text.
 */
function resolveHandles(ctx: CitationContext): {
  exam_handle: string;
  exercise_handle: string;
  question_handle: string;
} | null {
  const parsed = parsePairId(ctx.pair_id);
  const exam_handle = ctx.exam_handle ?? parsed?.exam_handle ?? null;
  const exercise_handle =
    ctx.exercise_handle ?? parsed?.exercise_handle ?? null;
  const question_handle =
    ctx.question_handle ?? parsed?.question_handle ?? null;
  if (!exam_handle || !exercise_handle || !question_handle) return null;
  return { exam_handle, exercise_handle, question_handle };
}

function escapeMarkdown(label: string): string {
  // Markdown link labels treat `]` as the end of the label. Escape it
  // so the agent's pasted `inline_link` survives verbatim insertion
  // into prose without breaking the rendered chip.
  return label.replace(/]/g, '\\]');
}

function buildInlineLink(label: string, refUri: string): string {
  return `[${escapeMarkdown(label)}](${refUri})`;
}

/**
 * Build the citation block for one Bac question (pair).
 *
 *   ref_uri:     lemma:pair:math-2024-principale-math:ex_1:q_1.a
 *   short_label: "Bac 2024 Ex 1 Q1.a"
 *   label:       "Bac 2024 principale · Math · Exercice 1 — Question 1.a"
 *   inline_link: "[Bac 2024 Ex 1 Q1.a](lemma:pair:math-2024-principale-math:ex_1:q_1.a)"
 */
export function buildPairCitation(ctx: CitationContext): Citation | null {
  const handles = resolveHandles(ctx);
  if (!handles) return null;
  const { exam_handle, exercise_handle, question_handle } = handles;
  const refUri = `lemma:pair:${exam_handle}:${exercise_handle}:${question_handle}`;
  const exerciseNum =
    ctx.exercise_number !== null && ctx.exercise_number !== undefined
      ? String(ctx.exercise_number)
      : exerciseNumberFromHandle(exercise_handle);
  const questionNum =
    ctx.question_number ?? questionNumberFromHandle(question_handle);
  const bac = bacShortLabel({ year: ctx.year, session: ctx.session });
  const matiere = matiereLabel(ctx.matiere);
  const shortPieces: string[] = [];
  if (bac) shortPieces.push(bac);
  if (exerciseNum) shortPieces.push(`Ex ${exerciseNum}`);
  if (questionNum) shortPieces.push(`Q${questionNum}`);
  const short_label = shortPieces.join(' ');
  const longPieces: string[] = [];
  longPieces.push(bacShortLabel({ year: ctx.year, session: ctx.session }));
  if (matiere) longPieces.push(matiere);
  if (exerciseNum) longPieces.push(`Exercice ${exerciseNum}`);
  if (questionNum) longPieces.push(`Question ${questionNum}`);
  const label = longPieces.filter(Boolean).join(' · ');
  return {
    ref_uri: refUri,
    short_label: short_label || label,
    label,
    inline_link: buildInlineLink(short_label || label, refUri),
  };
}

/**
 * Build the citation block for one figure inside a question.
 *
 * `index` is the 0-based position of the figure in the side's array.
 * The student-facing label uses the 1-based number.
 *
 *   ref_uri:     lemma:fig:math-2024-principale-math:ex_1:enonce:0
 *   short_label: "figure 1 de l'énoncé"
 *   label:       "Figure 1 de l'énoncé du Bac 2024 Ex 1"
 *   inline_link: "[figure 1 de l'énoncé](lemma:fig:math-2024-principale-math:ex_1:enonce:0)"
 */
export function buildFigureCitation(
  ctx: CitationContext,
  side: 'enonce' | 'corrige',
  index: number,
): Citation | null {
  const handles = resolveHandles(ctx);
  if (!handles) return null;
  const { exam_handle, exercise_handle } = handles;
  const refUri = `lemma:fig:${exam_handle}:${exercise_handle}:${side}:${index}`;
  const oneBased = index + 1;
  const sideLabel = side === 'enonce' ? "l'énoncé" : 'la correction';
  const short_label = `figure ${oneBased} de ${sideLabel}`;
  const exerciseNum =
    ctx.exercise_number !== null && ctx.exercise_number !== undefined
      ? String(ctx.exercise_number)
      : exerciseNumberFromHandle(exercise_handle);
  const bac = bacShortLabel({ year: ctx.year, session: ctx.session });
  const labelPieces: string[] = [`Figure ${oneBased} de ${sideLabel}`];
  if (bac && exerciseNum) labelPieces.push(`du ${bac} Ex ${exerciseNum}`);
  else if (bac) labelPieces.push(`du ${bac}`);
  const label = labelPieces.join(' ');
  return {
    ref_uri: refUri,
    short_label,
    label,
    inline_link: buildInlineLink(short_label, refUri),
  };
}

/**
 * Build the citation block for one exercise (no specific
 * sub-question).
 *
 *   ref_uri:     lemma:exercise:math-2024-principale-math:ex_1
 *   short_label: "Bac 2024 Ex 1"
 *   label:       "Bac 2024 principale · Math · Exercice 1"
 */
export function buildExerciseCitation(ctx: CitationContext): Citation | null {
  const handles = resolveHandles(ctx);
  // For exercise citations we don't need a question handle — but
  // resolveHandles requires one. Fall back to parsing any partial
  // input so callers can pass `pair_id_logical` directly.
  const exam_handle = ctx.exam_handle ?? handles?.exam_handle ?? null;
  const exercise_handle =
    ctx.exercise_handle ?? handles?.exercise_handle ?? null;
  if (!exam_handle || !exercise_handle) return null;
  const refUri = `lemma:exercise:${exam_handle}:${exercise_handle}`;
  const exerciseNum =
    ctx.exercise_number !== null && ctx.exercise_number !== undefined
      ? String(ctx.exercise_number)
      : exerciseNumberFromHandle(exercise_handle);
  const bac = bacShortLabel({ year: ctx.year, session: ctx.session });
  const matiere = matiereLabel(ctx.matiere);
  const short_label = exerciseNum
    ? `${bac} Ex ${exerciseNum}`
    : bac || exam_handle;
  const longPieces: string[] = [bac];
  if (matiere) longPieces.push(matiere);
  if (exerciseNum) longPieces.push(`Exercice ${exerciseNum}`);
  const label = longPieces.filter(Boolean).join(' · ');
  return {
    ref_uri: refUri,
    short_label,
    label,
    inline_link: buildInlineLink(short_label, refUri),
  };
}

/**
 * Build the citation block for a whole exam.
 *
 *   ref_uri:     lemma:exam:math-2024-principale-math
 *   short_label: "Bac 2024 principale math"
 *   label:       "Bac 2024 principale, Math (section math)"
 */
export function buildExamCitation(ctx: {
  exam_handle?: string | null;
  matiere?: string | null;
  year?: number | string | null;
  session?: string | null;
  track?: string | null;
}): Citation | null {
  const exam_handle = ctx.exam_handle ?? null;
  if (!exam_handle) return null;
  const refUri = `lemma:exam:${exam_handle}`;
  const bac = bacShortLabel({ year: ctx.year, session: ctx.session });
  const matiere = matiereLabel(ctx.matiere);
  const short_label = matiere ? `${bac} ${matiere.toLowerCase()}` : bac;
  const longPieces: string[] = [bac];
  if (matiere) longPieces.push(matiere);
  if (ctx.track) longPieces.push(`section ${ctx.track}`);
  const label = longPieces.filter(Boolean).join(' · ');
  return {
    ref_uri: refUri,
    short_label,
    label,
    inline_link: buildInlineLink(short_label, refUri),
  };
}
