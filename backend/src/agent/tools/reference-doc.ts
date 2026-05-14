/**
 * Per-exam "reference document" (a.k.a. *dossier*) helpers.
 *
 * Session 21 of the RAG ingest pipeline (`omni_v6.6`) added a family
 * of `reference_doc_*` payload fields to every Qdrant point whose
 * exam ships a shared spec / context document that every question
 * on the answer-sheet depends on. The canonical example is the
 * Tunisian *technique* exam, where the first ~7 pages of the
 * énoncé (motor specs, kinematic diagrams, schematics, FAST blocks)
 * are the *dossier technique* — every question references it
 * ("en se référant au dossier technique") and the agent could not
 * answer those questions before this integration because it only
 * saw cover-page boilerplate.
 *
 * The fields are denormalised — every pair from the same exam
 * carries the same `reference_doc_*`. Callers that need to inject
 * the dossier into an LLM context must dedupe by
 * `(exam_id, reference_doc_kind)` before stuffing (see
 * {@link collectReferenceDocsForLLM}).
 *
 * The integration is written **kind-agnostic** so future dossiers
 * (`dossier_comptable` for gestion, `mcd_schema` for bd, etc.) drop
 * in without code churn — only the {@link REFERENCE_DOC_KIND_LABELS}
 * lookup needs an entry.
 *
 * @see The full integration guide ships from the RAG-system Devin at
 *   `INTEGRATION_GUIDE.md` §10.
 */
import { buildImageUrl } from './index';
import { buildDossierFigureCitation, type Citation } from '../citations';
import type { QdrantPoint } from './qdrant.client';

/**
 * Default char budget for {@link ReferenceDoc.text} in the LLM
 * context. The full dossier text is 10–18k chars; the integration
 * guide §10.5 suggests 4k is a safe default that preserves the
 * system header + presentation + first few figures.
 *
 * Overridable via the `BACRAG_DOSSIER_CHAR_BUDGET` env var.
 */
export const REFERENCE_DOC_DEFAULT_CHAR_BUDGET = 4000;

/**
 * Resolve the per-exam dossier text budget the agent's context
 * builder should use. Reads `BACRAG_DOSSIER_CHAR_BUDGET` from the
 * environment when set, falls back to
 * {@link REFERENCE_DOC_DEFAULT_CHAR_BUDGET}, and clamps to
 * `[256, 20000]` so a misconfigured env var can't either starve the
 * model or blow up the context.
 */
export function resolveReferenceDocCharBudget(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.BACRAG_DOSSIER_CHAR_BUDGET;
  if (!raw) return REFERENCE_DOC_DEFAULT_CHAR_BUDGET;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return REFERENCE_DOC_DEFAULT_CHAR_BUDGET;
  return Math.max(256, Math.min(20_000, parsed));
}

/**
 * Known `reference_doc_kind` values mapped to French UI labels.
 * Unknown kinds get a Title-cased fallback so a future ingest can
 * add new kinds without breaking the rendered chip / tab — the
 * label is only ever used for display.
 */
export const REFERENCE_DOC_KIND_LABELS: Record<string, string> = {
  dossier_technique: 'Dossier technique',
  dossier_comptable: 'Dossier comptable',
  mcd_schema: 'Schéma MCD',
  chimie_preamble: 'Préambule de chimie',
};

export function referenceDocKindLabel(kind: string): string {
  return (
    REFERENCE_DOC_KIND_LABELS[kind] ??
    kind
      .split('_')
      .map((word) =>
        word.length === 0 ? word : word[0].toUpperCase() + word.slice(1),
      )
      .join(' ')
  );
}

/**
 * Read of one figure inside a dossier. Mirrors the structured
 * `reference_doc_figures[*]` entry on the Qdrant payload.
 */
export interface ReferenceDocFigureRaw {
  id: string;
  label: string;
  description: string;
  page_index: number;
  bbox_pct: [number, number, number, number] | null;
}

/**
 * Read of one full page in a dossier. Mirrors the
 * `reference_doc_pages_relpaths[*]` / `reference_doc_pages[*]`
 * pair on the Qdrant payload.
 */
export interface ReferenceDocPageRaw {
  page_index: number;
  relpath: string;
}

/** Parsed, validated form of every `reference_doc_*` field. */
export interface ReferenceDocRaw {
  kind: string;
  text: string;
  figures: ReferenceDocFigureRaw[];
  pages: ReferenceDocPageRaw[];
  split_method: string | null;
}

/**
 * Defensively read the `reference_doc_*` payload fields off a Qdrant
 * point. Returns `null` when the pair has no dossier (the common case
 * — only `matiere == "technique"` pairs ship one today).
 *
 * The shape contract is:
 *   - `has_reference_doc` must be `true` (or the four primary fields
 *     must all be populated — we tolerate the field being absent on
 *     ingest builds older than the Session 21 cut).
 *   - `reference_doc_text` must be a non-empty string.
 *   - At least one of `reference_doc_pages_relpaths` or
 *     `reference_doc_figures` must be a non-empty array.
 *
 * Anything that fails the contract returns `null` so callers can
 * silently fall back to the existing énoncé-only flow.
 */
export function readReferenceDoc(payload: unknown): ReferenceDocRaw | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  const hasFlag = p.has_reference_doc;
  if (hasFlag === false) return null;

  const text =
    typeof p.reference_doc_text === 'string' ? p.reference_doc_text : '';
  if (text.length === 0) return null;

  const kindRaw = p.reference_doc_kind;
  const kind =
    typeof kindRaw === 'string' && kindRaw.length > 0
      ? kindRaw
      : 'reference_doc';

  const figuresRaw = Array.isArray(p.reference_doc_figures)
    ? p.reference_doc_figures
    : [];
  const figures: ReferenceDocFigureRaw[] = [];
  for (const item of figuresRaw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : '';
    const label = typeof obj.label === 'string' ? obj.label : '';
    const description =
      typeof obj.description === 'string' ? obj.description : '';
    const pageIndexRaw = obj.page_index;
    const pageIndex =
      typeof pageIndexRaw === 'number' &&
      Number.isFinite(pageIndexRaw) &&
      Number.isInteger(pageIndexRaw) &&
      pageIndexRaw >= 0
        ? pageIndexRaw
        : null;
    if (!id || !label || pageIndex === null) continue;
    const bboxRaw = obj.bbox_pct;
    let bbox: [number, number, number, number] | null = null;
    if (Array.isArray(bboxRaw) && bboxRaw.length === 4) {
      const nums = bboxRaw.map((v) =>
        typeof v === 'number' && Number.isFinite(v) ? v : NaN,
      );
      if (nums.every((v) => Number.isFinite(v))) {
        bbox = [nums[0], nums[1], nums[2], nums[3]] as [
          number,
          number,
          number,
          number,
        ];
      }
    }
    figures.push({
      id,
      label,
      description,
      page_index: pageIndex,
      bbox_pct: bbox,
    });
  }

  const pageRelpathsRaw = Array.isArray(p.reference_doc_pages_relpaths)
    ? p.reference_doc_pages_relpaths
    : [];
  const pageIndicesRaw = Array.isArray(p.reference_doc_pages)
    ? p.reference_doc_pages
    : [];
  const pages: ReferenceDocPageRaw[] = [];
  for (let i = 0; i < pageRelpathsRaw.length; i++) {
    const entry = pageRelpathsRaw[i];
    if (typeof entry !== 'string' || entry.length === 0) continue;
    const indexCandidate = pageIndicesRaw[i];
    const pageIndex =
      typeof indexCandidate === 'number' &&
      Number.isFinite(indexCandidate) &&
      Number.isInteger(indexCandidate) &&
      indexCandidate >= 0
        ? indexCandidate
        : i;
    pages.push({ page_index: pageIndex, relpath: entry });
  }

  if (figures.length === 0 && pages.length === 0) return null;

  const splitMethod =
    typeof p.reference_doc_split_method === 'string' &&
    p.reference_doc_split_method.length > 0
      ? p.reference_doc_split_method
      : null;

  return { kind, text, figures, pages, split_method: splitMethod };
}

/**
 * One LLM-facing figure record inside the formatted dossier. The
 * `url` is the *page* PNG (cropping by `bbox_pct` is the renderer's
 * job — the v1 frontend draws the full page and lets the bbox sit
 * as an overlay hint).
 */
export interface FormattedReferenceDocFigure {
  id: string;
  label: string;
  description: string;
  page_index: number;
  page_png: string | null;
  bbox_pct: [number, number, number, number] | null;
  citation: Citation | null;
}

/** One LLM-facing dossier page record. */
export interface FormattedReferenceDocPage {
  page_index: number;
  url: string | null;
}

/**
 * Public-facing shape returned to the agent / frontend.
 *
 * - `text` is truncated to {@link FormattedReferenceDocOptions.charBudget}
 *   when the source is longer; the `text_truncated` boolean lets the
 *   caller know.
 * - `figures` always carry the page PNG; `bbox_pct` is the optional
 *   crop hint.
 * - `citation` references a `lemma:dossier_fig:<exam_handle>:<id>`
 *   URI when the exam handle is known.
 */
export interface FormattedReferenceDoc {
  kind: string;
  kind_label: string;
  text: string;
  text_truncated: boolean;
  text_full_length: number;
  figures: FormattedReferenceDocFigure[];
  pages: FormattedReferenceDocPage[];
  n_figures: number;
  n_pages: number;
  split_method: string | null;
}

export interface FormattedReferenceDocOptions {
  cdnBase?: string;
  /** Override the default char budget (defaults to {@link resolveReferenceDocCharBudget}). */
  charBudget?: number;
  /** When provided, build per-figure `lemma:dossier_fig:<exam>:<id>` citations. */
  examHandle?: string | null;
}

/**
 * Translate a parsed {@link ReferenceDocRaw} into the LLM-/UI-facing
 * shape: resolves page relpaths to full URLs via {@link buildImageUrl},
 * truncates the text to the agreed char budget, and (when an exam
 * handle is known) attaches a `lemma:dossier_fig` citation to each
 * figure.
 */
export function formatReferenceDocForLLM(
  raw: ReferenceDocRaw,
  opts?: FormattedReferenceDocOptions,
): FormattedReferenceDoc {
  const budget = opts?.charBudget ?? resolveReferenceDocCharBudget();
  const fullLength = raw.text.length;
  const truncated = fullLength > budget;
  const text = truncated ? raw.text.slice(0, budget) : raw.text;

  const pageRelpathByIndex = new Map<number, string>();
  for (const page of raw.pages) {
    pageRelpathByIndex.set(page.page_index, page.relpath);
  }

  const pages: FormattedReferenceDocPage[] = raw.pages.map((p) => ({
    page_index: p.page_index,
    url: buildImageUrl(p.relpath, opts?.cdnBase),
  }));

  const figures: FormattedReferenceDocFigure[] = raw.figures.map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    page_index: f.page_index,
    page_png: buildImageUrl(
      pageRelpathByIndex.get(f.page_index) ?? null,
      opts?.cdnBase,
    ),
    bbox_pct: f.bbox_pct,
    citation: opts?.examHandle
      ? buildDossierFigureCitation({
          exam_handle: opts.examHandle,
          figure_id: f.id,
          label: f.label,
          kind: raw.kind,
        })
      : null,
  }));

  return {
    kind: raw.kind,
    kind_label: referenceDocKindLabel(raw.kind),
    text,
    text_truncated: truncated,
    text_full_length: fullLength,
    figures,
    pages,
    n_figures: figures.length,
    n_pages: pages.length,
    split_method: raw.split_method,
  };
}

/**
 * Dedupe a batch of retrieved Qdrant points by
 * `(exam_id, reference_doc_kind)` and produce one formatted dossier
 * per unique key. Mirrors the snippet in `INTEGRATION_GUIDE.md`
 * §10.5: when 3 pairs from the same technique exam come back from
 * Qdrant we only want to inject the dossier into the LLM context
 * once.
 *
 * Skips points without an `exam_id` payload field or without a
 * usable dossier (silently — see {@link readReferenceDoc} for the
 * contract).
 */
export function collectReferenceDocsForLLM(
  points: Array<Pick<QdrantPoint, 'payload'>>,
  opts?: FormattedReferenceDocOptions & {
    /** Resolve the exam handle for a point — defaults to `payload.exam_id`. */
    examHandleOf?: (payload: Record<string, unknown>) => string | null;
  },
): Array<{ exam_handle: string; doc: FormattedReferenceDoc }> {
  const examHandleOf =
    opts?.examHandleOf ??
    ((payload: Record<string, unknown>) =>
      typeof payload.exam_id === 'string' && payload.exam_id.length > 0
        ? payload.exam_id
        : null);

  const seen = new Set<string>();
  const out: Array<{ exam_handle: string; doc: FormattedReferenceDoc }> = [];
  for (const point of points) {
    const payload = (point.payload ?? {}) as Record<string, unknown>;
    const examHandle = examHandleOf(payload);
    if (!examHandle) continue;
    const raw = readReferenceDoc(payload);
    if (!raw) continue;
    const key = `${examHandle}::${raw.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      exam_handle: examHandle,
      doc: formatReferenceDocForLLM(raw, {
        ...opts,
        examHandle,
      }),
    });
  }
  return out;
}
