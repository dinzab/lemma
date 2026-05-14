/**
 * Client-side resolver for `lemma:` URIs. Mirrors the typed payloads
 * returned by the NestJS `ReferencesController` so the chip surfaces
 * can render directly against the resolver response.
 *
 * The resolver is the fallback path for inline citation chips: when
 * the in-conversation `<FigureRegistry>` doesn't (yet) carry a
 * thumbnail for a `lemma:fig:…` URI, or a `lemma:exercise:…` /
 * `lemma:exam:…` chip's click finds no on-page surface to scroll to,
 * the chip hits this proxy to recover the asset URL + metadata.
 */

export interface LemmaCitation {
  ref_uri: string;
  short_label: string;
  label: string;
  inline_link: string;
}

export interface LemmaExamMeta {
  exam_handle: string;
  exam_id: string | null;
  matiere: string | null;
  year: number | string | null;
  session: string | null;
  track: string | null;
  exam: string | null;
}

export interface LemmaExerciseMeta {
  exercise_handle: string;
  exercise_number: number | string | null;
  exercise_enonce_image_url: string | null;
  exercise_corrige_image_url: string | null;
  exam_full_enonce_url: string | null;
  exam_full_corrige_url: string | null;
}

export interface ResolvedFigure {
  url: string | null;
  label: string;
  caption: string | null;
  side: "enonce" | "corrige";
  index: number;
  citation: LemmaCitation | null;
}

export interface ResolvedFigureResponse {
  kind: "figure";
  uri: string;
  citation: LemmaCitation | null;
  exam: LemmaExamMeta;
  exercise: LemmaExerciseMeta;
  figure: ResolvedFigure;
}

export interface ResolvedExerciseResponse {
  kind: "exercise";
  uri: string;
  citation: LemmaCitation | null;
  label: string;
  short_label: string;
  exam: LemmaExamMeta;
  exercise: LemmaExerciseMeta;
  figures: { enonce: ResolvedFigure[]; corrige: ResolvedFigure[] };
  pair_id: string | null;
}

export interface ResolvedPairResponse {
  kind: "pair";
  uri: string;
  citation: LemmaCitation | null;
  exercise_citation: LemmaCitation | null;
  exam_citation: LemmaCitation | null;
  label: string;
  short_label: string;
  pair_id: string | null;
  question_number: string | null;
  question_text: string | null;
  answer_text: string | null;
  exam: LemmaExamMeta;
  exercise: LemmaExerciseMeta;
  figures: { enonce: ResolvedFigure[]; corrige: ResolvedFigure[] };
}

export interface ResolvedExamResponse {
  kind: "exam";
  uri: string;
  citation: LemmaCitation | null;
  label: string;
  short_label: string;
  exam: LemmaExamMeta;
  exercises: Array<{
    exercise_handle: string;
    exercise_number: number | null;
    n_questions: number;
    n_enonce_figures: number;
    n_corrige_figures: number;
  }>;
  exam_full_enonce_url: string | null;
  exam_full_corrige_url: string | null;
}

export interface ResolvedDossierFigure {
  id: string;
  label: string;
  description: string;
  page_index: number;
  page_png: string | null;
  bbox_pct: [number, number, number, number] | null;
  citation: LemmaCitation | null;
}

export interface ResolvedDossierFigureResponse {
  kind: "dossier_figure";
  uri: string;
  citation: LemmaCitation | null;
  exam: LemmaExamMeta;
  reference_doc_kind: string;
  reference_doc_kind_label: string;
  figure: ResolvedDossierFigure;
}

export type ResolvedReference =
  | ResolvedFigureResponse
  | ResolvedExerciseResponse
  | ResolvedPairResponse
  | ResolvedExamResponse
  | ResolvedDossierFigureResponse;

/**
 * Process-local memoisation so a chip rendered once doesn't re-fetch
 * on every keystroke during a streaming reply. Keys are the raw
 * `lemma:` URI; values are either the resolved JSON or `null` when
 * the resolver returned 4xx (don't keep retrying — those are
 * deterministic responses).
 */
const cache = new Map<string, Promise<ResolvedReference | null>>();

/**
 * Fetch and cache a `lemma:` URI's resolution. Returns `null` when
 * the resolver returns 4xx (malformed URI / no corpus entry); throws
 * for 5xx so the caller can surface a transient error UI.
 */
export function resolveLemmaUri(
  uri: string,
): Promise<ResolvedReference | null> {
  const cached = cache.get(uri);
  if (cached) return cached;
  const promise = fetchResolution(uri).catch((err) => {
    // Drop the cached failure so a transient network error doesn't
    // poison the chip for the rest of the session.
    cache.delete(uri);
    throw err;
  });
  cache.set(uri, promise);
  return promise;
}

async function fetchResolution(
  uri: string,
): Promise<ResolvedReference | null> {
  const res = await fetch(
    `/api/references/lemma?uri=${encodeURIComponent(uri)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  );
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `lemma resolver failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as ResolvedReference;
}
