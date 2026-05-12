import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Single inspection focus, dictating the *kind* of structured fields the
 * vision model is asked to extract alongside its free-form analysis.
 *
 * We expose a fixed enum (rather than an open-ended hint) so the system
 * prompt + caching key + structured-fields contract stay in lock-step.
 * Adding a new focus is a code change, not a runtime decision.
 */
export type FigureFocus =
  | 'general'
  | 'axes'
  | 'values'
  | 'topology'
  | 'text'
  | 'count';

export interface FigureAnalysis {
  /**
   * 1–4 sentence French free-form analysis of the figure, grounded in
   * the optional `question` passed by the caller. This is the primary
   * payload the agent reasons over downstream — the structured fields
   * below are best-effort hints.
   */
  analysis: string;
  /** Axes labels + ranges, populated when focus matches "axes" / "values" / "general". */
  axes?: {
    x?: string;
    y?: string;
    x_range?: string;
    y_range?: string;
  } | null;
  /** Notable (x, y) readings from a graph; populated when focus="values". */
  values?: Array<{ x: string; y: string }> | null;
  /**
   * Free-form classification (e.g. "RC_series", "RLC_parallel",
   * "free_body_inclined_plane"). Populated when focus="topology".
   */
  topology?: string | null;
  /** OCR'd in-figure text fragments (legend labels, embedded equations). */
  text_ocr?: string[] | null;
  /** Object/element count when focus="count" (vectors, capacitors, peaks…). */
  count?: number | null;
  /**
   * Self-reported confidence on a 0..1 scale — lets the agent gate
   * follow-up questions or hedge its prose when the model is unsure.
   */
  confidence?: number | null;
}

export interface AnalyzeFigureOpts {
  imageUrl: string;
  /** The natural-language question the caller wants answered about the figure. */
  question?: string;
  focus?: FigureFocus;
  /**
   * Optional caller-supplied caption (the existing 240/600-char French
   * caption from the corpus). When present, we forward it to the
   * model so it can ground its analysis in the corpus's naming
   * conventions ("Figure 1" vs "schéma a"), and so the model can
   * acknowledge / contradict the caption explicitly.
   */
  caption?: string;
}

export interface VisionAnalysisResult {
  /** Parsed structured analysis (best-effort). */
  analysis: FigureAnalysis;
  /** Vision model identifier the request was routed to. */
  model: string;
  /** Whether the response was successfully parsed as JSON (false ⇒ best-effort fallback). */
  structured: boolean;
}

const DEFAULT_VISION_MODEL = 'meta/llama-3.2-90b-vision-instruct';
const DEFAULT_VISION_URL =
  'https://integrate.api.nvidia.com/v1/chat/completions';

/**
 * Strip a trailing `/` and an optional trailing `/chat/completions`
 * from an OpenAI-compatible base URL so we can always append a single
 * canonical `/chat/completions` segment. Keeps the fallback logic
 * tolerant of operators who configure `NVIDIA_BASE_URL` with or
 * without the trailing slash, and with or without the path suffix.
 */
function toChatCompletionsUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}
/**
 * Vision LLMs occasionally hang or stall on huge PDF-derived crops; cap
 * the wall clock so a single bad figure can't block a tool turn.
 */
const VISION_TIMEOUT_MS = 30_000;
const VISION_MAX_TOKENS = 700;

const FOCUS_PROMPT_HINTS: Record<FigureFocus, string> = {
  general:
    'Décris la figure de manière concise (1–3 phrases). Renseigne les ' +
    'axes si la figure est un graphe.',
  axes:
    'Identifie précisément les axes : nom, unité, plage min..max. ' +
    'Renseigne `axes` dans la réponse.',
  values:
    'Lis les valeurs notables sur le graphe (intersections, asymptotes, ' +
    'valeurs en t=0, valeurs au régime permanent). Liste-les dans `values`.',
  topology:
    'Identifie la topologie du circuit / schéma (RC série, RLC parallèle, ' +
    'plan incliné avec frottement, etc.) et renseigne `topology`.',
  text:
    'Extrais le texte présent dans la figure (légendes, équations, valeurs ' +
    'numériques annotées). Liste-les dans `text_ocr`.',
  count:
    'Compte les éléments demandés (vecteurs, condensateurs, pics, etc.) ' +
    'et renseigne `count`.',
};

const SYSTEM_PROMPT_FR = `Tu es un assistant pédagogique spécialisé dans la lecture de figures d'examens scientifiques tunisiens (BAC). Tu réponds **toujours** en JSON valide qui satisfait ce schéma :

{
  "analysis": "1 à 4 phrases en français — observation factuelle, sans inventer.",
  "axes": null OU { "x": "…", "y": "…", "x_range": "min..max", "y_range": "min..max" },
  "values": null OU [ { "x": "…", "y": "…" } ],
  "topology": null OU "string courte (RC_series, RLC_parallel, …)",
  "text_ocr": null OU [ "string", "string" ],
  "count": null OU number,
  "confidence": 0..1
}

Règles strictes :
- Si une information n'est PAS visible sur la figure, mets le champ à \`null\` — n'invente rien.
- N'inclus aucun texte hors du JSON. Pas de Markdown, pas de \`\`\`json fences.
- Si la figure est illisible ou hors-sujet, renvoie \`{"analysis":"…","confidence":0,…}\` avec \`confidence\` faible et tous les champs structurés à \`null\`.
- \`analysis\` ne doit JAMAIS être vide.`;

/**
 * Vision client backed by any OpenAI-compatible chat-completions
 * endpoint. Wraps it with a single-image multimodal user message and
 * a strict JSON-only system prompt.
 *
 * Endpoint resolution order (first match wins):
 *   1. `NIM_VISION_URL` — explicit override (legacy NVIDIA NIM
 *      deployments still hit `https://integrate.api.nvidia.com/v1`).
 *   2. `${NVIDIA_BASE_URL}/chat/completions` — when the chat model
 *      itself is omni-capable (e.g. Xiaomi MiMo-V2.5-Pro served from
 *      `https://token-plan-sgp.xiaomimimo.com/v1`), reuse the same
 *      endpoint so a single model handles both chat and figure
 *      perception. This is the path the prompt assumes when it tells
 *      the agent to call `inspect_figure` aggressively.
 *   3. `https://integrate.api.nvidia.com/v1/chat/completions` —
 *      historical default for the standalone NIM vision model.
 *
 * Model resolution order:
 *   1. `NIM_VISION_MODEL` — explicit override.
 *   2. `NVIDIA_MODEL_NAME` — only when `NVIDIA_BASE_URL` is also set
 *      (so we never accidentally ship a chat-only model id to the
 *      legacy NIM vision endpoint that doesn't host it).
 *   3. `meta/llama-3.2-90b-vision-instruct` — historical default.
 *
 * Auth: prefers `NIM_VISION_API_KEY`, falls back to `NVIDIA_API_KEY` for
 * deployments that share a single key across embed/rerank/chat/vision
 * (matches the same auth pattern the other clients use). Never logs
 * the key.
 *
 * The client is **non-fatal**: any HTTP / parse / timeout failure
 * surfaces as a stub `FigureAnalysis` whose `analysis` field carries
 * the failure reason and `confidence=0`. Callers can still wrap the
 * response in a tool result without crashing the agent turn — RAG
 * quality degrades to "caption-only" rather than disappearing.
 */
@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);

  constructor(private readonly config: ConfigService) {}

  async analyzeFigure(opts: AnalyzeFigureOpts): Promise<VisionAnalysisResult> {
    const apiKey =
      this.config.get<string>('NIM_VISION_API_KEY') ??
      this.config.get<string>('NVIDIA_API_KEY') ??
      this.config.get<string>('NVIDEA_API_KEY');

    const explicitVisionUrl = this.config.get<string>('NIM_VISION_URL');
    const explicitVisionModel = this.config.get<string>('NIM_VISION_MODEL');
    const nvidiaBaseUrl = this.config.get<string>('NVIDIA_BASE_URL');
    const nvidiaModelName = this.config.get<string>('NVIDIA_MODEL_NAME');

    // When no separate vision endpoint is configured, fall back to the
    // chat endpoint provisioned via `NVIDIA_BASE_URL`. This keeps the
    // omni MiMo path zero-config: the same base URL + model id that
    // drives the chat node also serves `inspect_figure`, instead of
    // requiring operators to provision a separate NIM vision key.
    const url =
      explicitVisionUrl ??
      (nvidiaBaseUrl
        ? toChatCompletionsUrl(nvidiaBaseUrl)
        : DEFAULT_VISION_URL);
    const model =
      explicitVisionModel ??
      (nvidiaBaseUrl && nvidiaModelName
        ? nvidiaModelName
        : DEFAULT_VISION_MODEL);

    if (!apiKey) {
      this.logger.warn(
        'No vision API key set (NIM_VISION_API_KEY or NVIDIA_API_KEY) — ' +
          'returning a stub vision analysis. Set the key to enable inspect_figure.',
      );
      return this.stub(model, 'no_api_key');
    }

    const focus: FigureFocus = opts.focus ?? 'general';
    const userPrompt = this.buildUserPrompt(focus, opts.question, opts.caption);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model,
          // The OpenAI-compatible NIM chat schema accepts an array of
          // typed content blocks for the user message; vision-capable
          // models recognise `image_url` blocks and fetch them server-
          // side. We pass the public R2 URL directly so we don't pay
          // egress to download → re-upload as base64.
          messages: [
            { role: 'system', content: SYSTEM_PROMPT_FR },
            {
              role: 'user',
              content: [
                { type: 'text', text: userPrompt },
                { type: 'image_url', image_url: { url: opts.imageUrl } },
              ],
            },
          ],
          temperature: 0.1,
          top_p: 0.7,
          max_tokens: VISION_MAX_TOKENS,
          // Most NIM vision endpoints honour `response_format: json_object`
          // when the model supports it; we send it for free as a hint and
          // still parse defensively because not all models do.
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `NIM vision ${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
        );
        return this.stub(model, `http_${res.status}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!raw) {
        return this.stub(model, 'empty_response');
      }

      const parsed = parseVisionPayload(raw);
      if (parsed) {
        return { analysis: parsed, model, structured: true };
      }

      // Best-effort fallback: surface the raw text as `analysis` so the
      // agent still has *some* signal even when JSON parsing fails.
      return {
        analysis: {
          analysis: raw.slice(0, 600),
          axes: null,
          values: null,
          topology: null,
          text_ocr: null,
          count: null,
          confidence: 0.3,
        },
        model,
        structured: false,
      };
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'AbortError'
          ? 'timeout'
          : (err as Error).message;
      this.logger.warn(`NIM vision call failed: ${reason}`);
      return this.stub(model, reason);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildUserPrompt(
    focus: FigureFocus,
    question?: string,
    caption?: string,
  ): string {
    const lines: string[] = [];
    lines.push(FOCUS_PROMPT_HINTS[focus]);
    if (caption && caption.trim()) {
      lines.push(
        `Légende existante (peut être incomplète) : ${caption.trim()}`,
      );
    }
    if (question && question.trim()) {
      lines.push(`Question du tuteur : ${question.trim()}`);
    }
    lines.push('Réponds en JSON UNIQUEMENT, conformément au schéma système.');
    return lines.join('\n');
  }

  private stub(model: string, reason: string): VisionAnalysisResult {
    return {
      analysis: {
        analysis: `Vision non disponible (${reason}); aucune lecture du pixel.`,
        axes: null,
        values: null,
        topology: null,
        text_ocr: null,
        count: null,
        confidence: 0,
      },
      model,
      structured: false,
    };
  }
}

/**
 * Best-effort JSON parser for vision responses.
 *
 * NIM models occasionally wrap their JSON in ` ```json ... ``` ` fences
 * despite the system prompt asking them not to. We strip those before
 * parsing and clamp every field to its declared type — anything weird
 * (NaN confidence, non-array values, non-numeric count) is coerced to
 * `null` so the downstream agent never has to worry about runtime
 * surprises.
 */
export function parseVisionPayload(raw: string): FigureAnalysis | null {
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  const analysis =
    typeof o.analysis === 'string' && o.analysis.trim().length > 0
      ? o.analysis.trim()
      : null;
  if (!analysis) return null;

  const axes = parseAxes(o.axes);
  const values = parseValues(o.values);
  const topology =
    typeof o.topology === 'string' && o.topology.trim().length > 0
      ? o.topology.trim()
      : null;
  const text_ocr = parseStringArray(o.text_ocr);
  const count =
    typeof o.count === 'number' && Number.isFinite(o.count) && o.count >= 0
      ? Math.round(o.count)
      : null;
  const confidence = parseConfidence(o.confidence);

  return {
    analysis,
    axes,
    values,
    topology,
    text_ocr,
    count,
    confidence,
  };
}

function parseAxes(raw: unknown): FigureAnalysis['axes'] {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: NonNullable<FigureAnalysis['axes']> = {};
  if (typeof r.x === 'string' && r.x.trim()) out.x = r.x.trim();
  if (typeof r.y === 'string' && r.y.trim()) out.y = r.y.trim();
  if (typeof r.x_range === 'string' && r.x_range.trim()) {
    out.x_range = r.x_range.trim();
  }
  if (typeof r.y_range === 'string' && r.y_range.trim()) {
    out.y_range = r.y_range.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseValues(raw: unknown): FigureAnalysis['values'] {
  if (!Array.isArray(raw)) return null;
  const out: Array<{ x: string; y: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const x =
      typeof r.x === 'string' || typeof r.x === 'number' ? String(r.x) : null;
    const y =
      typeof r.y === 'string' || typeof r.y === 'number' ? String(r.y) : null;
    if (x !== null && y !== null) out.push({ x, y });
  }
  return out.length > 0 ? out : null;
}

function parseStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .filter((r): r is string => typeof r === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return out.length > 0 ? out : null;
}

function parseConfidence(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}
