import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import {
  QdrantClientProvider,
  type QdrantCondition,
  type QdrantFilter,
  type QdrantPoint,
} from './qdrant.client';
import { Neo4jClientProvider } from './neo4j.client';
import { EmbeddingsClient } from './embeddings.client';
import { RerankerClient } from './reranker.client';
import { AnalogiesClient } from './analogies.client';
import { PatternsClient } from './patterns.client';

/**
 * Description for the write_todos planning tool. Mirrors the public
 * description that ships with langchain's `TodoListMiddleware` (the
 * upstream of deepagents' `write_todos`) so any given LLM that has been
 * tuned against deepagents-style planning prompts will recognise it. We
 * tailor the few examples to the Tunisian Bac tutoring domain.
 */
const WRITE_TODOS_TOOL_DESCRIPTION = `Use this tool to create and manage a structured task list for your current work session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the student.

Only use this tool if you think it will help you stay organized. If the student's request is trivial and takes fewer than 3 steps, do NOT use this tool — just answer directly.

## When to Use This Tool
1. Complex multi-step tasks (3 or more distinct steps).
2. Non-trivial tasks that require planning or multiple operations.
3. The student explicitly asks for a study plan / roadmap.
4. The student gives a list of things they want done.
5. The plan may need revision as you discover what the corpus contains.

## How to Use This Tool
1. Mark a task in_progress BEFORE you start working on it.
2. Mark a task completed IMMEDIATELY after finishing it — never batch completions.
3. Revise the list as you learn — add new items, remove items that became irrelevant. Don't change items already marked completed.
4. Each call REPLACES the entire todo list, so always re-include items that should remain.

## When NOT to Use This Tool
1. Single, straightforward tasks.
2. Trivial requests where tracking adds no value.
3. Anything completable in fewer than ~3 substantive steps.
4. Conversational replies, greetings, or factual definitions.

## Task States
- pending: Not yet started.
- in_progress: Currently working on. Always have at least one in_progress until everything is done.
- completed: Fully finished. Never mark completed if the work is partial or blocked.

## Task Quality
- Items must be specific and actionable. Prefer "Find 3 hardest 2018 controle math problems on arithmétique" over "Search the corpus".
- Break complex objectives into smaller steps you can actually verify.

## Important Notes
- Never call write_todos multiple times in parallel.
- Don't be afraid to revise the list — new information may reveal new tasks or make old ones obsolete.
`;

/**
 * Description for the emit_hint_ladder pedagogical tool. Forces the
 * model to emit four progressively-richer hints as a structured
 * payload instead of dumping the full solution as prose. The frontend
 * renders the result as the A1 Hint Ladder accordion — four collapsed
 * pills the student opens at their own pace, with rung 4 visually
 * de-emphasised so the student is gently guided to try the smaller
 * hints first.
 */
const EMIT_HINT_LADDER_TOOL_DESCRIPTION = `Use this tool when a student is stuck on a problem and asks for help, or when you would otherwise be tempted to dump a full step-by-step solution as prose. The student sees a stacked accordion of four progressively-richer hints and chooses how much help to reveal — they read rung 1 (a one-sentence steer) first, then rung 2 (the high-level technique), then rung 3 (the first move of the working) before peeking at rung 4 (the full solution). This is the single highest-leverage pedagogical move you can make: it forces the student to do as much of the thinking as they can before peeking, which is the only setup that actually produces learning.

## When to Use This Tool
1. The student asks a problem-shaped question ("how do I solve...", "je suis bloqué sur...", "explique-moi cet exercice", "aide-moi avec…") and there is enough information in the conversation to actually structure a 4-rung response.
2. The student paraphrases or pastes a specific exercise and is asking for guidance, not just a definition.
3. The student has already attempted a step and is stuck mid-working — emit a ladder targeted at where they are stuck (rung 1 still nudges, rung 2-3 push deeper into the right technique).

## When NOT to Use This Tool
1. Pure metadata / discovery questions ("how many exam papers in 2018?", "list chapters in math", "qu'est-ce qu'une matière ?").
2. Pure concept definitions with no specific problem to solve ("c'est quoi la mitose ?", "définis le mot dérivée"). For those, recall_analogy + recall_pattern + a normal prose explanation is the right shape.
3. Trivial problems where a one-line answer is enough — forcing four rungs would feel patronising.
4. The student has explicitly asked for the full solution twice — honour the request and stepwise-walk through it instead.
5. You don't actually have a 4-rung structure to give. If your rungs would all say the same thing in different words, this tool is the wrong shape and you should answer in prose instead.

## How to Structure the Four Rungs
- **tiny_nudge** — ONE sentence. The smallest steer that points at the key observation. Examples: "Look at the modulus before the argument.", "Pense à ce qui se conserve dans le mouvement.", "Quel signe change quand tu dérives la valeur absolue ?". Never names the technique outright.
- **technique** — ONE or two sentences naming the high-level approach by name ("Use the trigonometric form of complex numbers", "Applique le PFD selon l'axe horizontal puis vertical"). Still no working.
- **first_move** — The first concrete line of working only. Show the setup of the equation / the first integration step / the first call of the recurrence. Stop after that line.
- **full_solution** — The complete worked solution. Use LaTeX, structure with numbered steps if helpful. The frontend de-emphasises this rung visually — it stays clickable, but the student is nudged to try the smaller rungs first.

## Important Notes
- Emit all four rungs every time. The whole point of the ladder is the gradient of help.
- The chip IS the hint ladder. Do NOT also restate the rungs as bullet points in your prose. A short framing sentence before the chip ("Voici quelques pistes pour avancer.") is fine; restating the rungs is the bug.
- Pass a short \`problem_summary\` (one sentence) so the chip has a header even when the student scrolls back.
- Match the language of the student in every rung (FR or EN).
`;

/**
 * Description for the emit_solution_steps pedagogical tool. Forces
 * the model to emit a worked solution as a structured stack of
 * numbered cards (each with its own title, working, and justification)
 * instead of dumping a wall of LaTeX as prose. The frontend renders
 * the result as the A4 Stepwise Solution Cards — every card folded by
 * default, expanded one tap at a time, with optional "⚠ Common
 * mistake here" callouts and a "🤔 Predict the next step" active-
 * recall gate that hides subsequent cards until the student types
 * their guess.
 */
const EMIT_SOLUTION_STEPS_TOOL_DESCRIPTION = `Use this tool when the student has explicitly asked for the full worked solution to a specific exercise, OR when the Hint Ladder isn't the right shape (e.g. they already worked through the hints and now want to see it laid out, or they're reviewing a corrigé). The student sees a numbered card stack — every card folded by default, expanded one tap at a time — instead of a wall of LaTeX. Each card is a single step with its own equation, justification, and an optional "common mistake" callout. Some cards can carry a "Predict the next step" gate that hides the following card until the student types their guess: this is the highest-leverage active-recall move there is.

## When to Use This Tool
1. The student has explicitly asked for the full solution / corrigé ("montre-moi la résolution complète", "déroule-moi tout l'exercice", "give me the full solution").
2. The student has already worked through the Hint Ladder and now wants to see the worked-out steps laid out cleanly.
3. The agent is reviewing a past-paper exercise step by step (e.g. after a search_questions match where the student wants to walk through the corrigé).
4. The exercise has 3 or more meaningful steps. Two-line problems should stay in prose.

## When NOT to Use This Tool
1. The student hasn't asked for the full solution and is still working through hints — use emit_hint_ladder, don't pre-empt to the worked solution.
2. Pure metadata / discovery questions or pure concept definitions.
3. One-shot answers that fit on a single line.
4. The student has already pasted their own attempt and wants targeted feedback — that is the Error-Diagnosis Card surface (A5), not stepwise cards.

## How to Structure Each Step
- **title** — one short verb phrase that names what this step accomplishes ("Mettre $z$ sous forme exponentielle", "Calculer le module", "Dresser le tableau de variations"). Match the student's language. NO numbering — the frontend prepends "Étape N".
- **latex** — the actual working line(s) for this step, in LaTeX. Use \`$...$\` for inline and \`$$...$$\` for display math. One step = one (or a few tightly-related) lines of working, not a whole sub-derivation.
- **justification** — one or two sentences explaining *why* this step works — the rule / theorem / observation that licences the move. This is the part students miss when they read a corrigé; surface it explicitly.
- **common_mistake** (optional) — the typical Tunisian-BAC trap on this step. Skip the field when the step has no notable trap.
- **predict_next** (optional) — set to true on a step when the next move is something the student should be able to figure out from what's already on screen. The frontend hides the following step behind a "🤔 Predict the next step" affordance with a text input; the student types their guess (anything; we don't validate) and the next card unlocks. Use sparingly — 1-2 gates per solution, on the most pedagogically valuable transitions. Do NOT set on the last step.

## Important Notes
- Order matters. The frontend renders steps in array order with auto-numbering.
- Pass a short \`problem_summary\` (one sentence, in the student's language) so the card stack has a header even when the student scrolls back.
- The card stack IS the solution. Do NOT also restate the steps as a numbered prose list afterwards — the frontend already shows them. A short framing sentence before the stack ("Voici la résolution étape par étape.") is fine; re-narrating the steps in prose is the bug.
- Match the student's language in every field (FR or EN). Don't mix.
- 3-8 steps is the sweet spot. Fewer than 3 — use prose. More than 8 — the student loses the thread; consolidate.
`;

/**
 * Canonical Tunisian Bac **section** (a.k.a. "track") values as they
 * appear in the v6 Qdrant `track` / `filiere` payload field. Exposed
 * as a typed enum to every tool that filters by section, so the model
 * can't fabricate a value like `"sciences"` (which doesn't exist — the
 * right code is `"sciences-ex"`). Mirrors the values returned by the
 * Qdrant facet on `track` (see `list_sections`).
 *
 * Tunisian student-facing vocabulary mapping:
 *  - sciences-ex       = "section sciences expérimentales"
 *                       (often shortened to "section science"
 *                       or just "sciences")
 *  - math              = "section mathématiques"
 *  - technique         = "section sciences techniques"
 *  - informatique      = "section sciences informatique"
 *  - economie-gestion  = "section économie et gestion"
 *
 * NOTE: the *track* `math` (Bac section) and the *matière* `math`
 * (the maths subject) collide on the same word — when the student
 * just says "math", check the broader phrasing to disambiguate
 * ("la section math" → track; "un exercice de math" → matière).
 *
 * v6 cutover note: the v1 collection used underscored values
 * (`sciences_ex`, `economie_gestion`); v6 uses hyphens
 * (`sciences-ex`, `economie-gestion`). The agent and prompt are
 * unified on v6's hyphenated form. Any caller still passing the
 * legacy underscored form is normalised at the filter boundary
 * (see {@link normalizeSection}).
 */
const SECTION_ENUM = [
  'sciences-ex',
  'math',
  'technique',
  'informatique',
  'economie-gestion',
  // Legacy v1 underscored variants — accepted at the schema boundary
  // and normalised to the hyphenated form before any data-store call
  // (see {@link normalizeSection}). Without these, in-flight tool
  // calls cached from a pre-v6 conversation state would fail Zod
  // validation before they ever reach the normaliser.
  'sciences_ex',
  'economie_gestion',
] as const;

/**
 * Human-friendly description for each section code, surfaced inside
 * `list_sections` so the agent can map a vague natural-language
 * section reference ("section science", "BAC math", "éco-gestion") to
 * the canonical track value without rote memorisation.
 */
const SECTION_DESCRIPTIONS: Record<string, string> = {
  'sciences-ex':
    'Section sciences expérimentales (often shortened to "section science" or just "sciences").',
  math: 'Section mathématiques.',
  technique: 'Section sciences techniques.',
  informatique: 'Section sciences informatique.',
  'economie-gestion': 'Section économie et gestion.',
};

/**
 * Tolerate the legacy v1 section codes (underscored) by normalising to
 * the v6 hyphenated form. Catches `sciences_ex` / `economie_gestion`
 * from older agent tool calls cached in conversation state during the
 * v1→v6 cutover, and the very common student-typed underscore form.
 */
function normalizeSection(track: string | undefined): string | undefined {
  if (!track) return track;
  if (track === 'sciences_ex') return 'sciences-ex';
  if (track === 'economie_gestion') return 'economie-gestion';
  return track;
}

/**
 * Domain-shaped tools the LLM binds against. Each verb mirrors how a
 * student / tutor talks about the Tunisian Baccalaureate corpus rather
 * than the underlying data store, so the agent can reason about
 * "questions on a chapter" instead of "points in a Qdrant collection".
 *
 * Surface (10 + planning):
 *   - search_questions       semantic retrieval + rerank, w/ filters
 *   - get_question_pair      full Q/A pair by pair_id
 *   - find_similar_questions vector neighbours of a known pair
 *   - count_questions        aggregate over filters (no embedding cost)
 *   - list_chapters          Neo4j catalogue, by matiere
 *   - list_topics            Neo4j catalogue, by matiere/chapter
 *   - list_exams             Neo4j exam metadata catalogue
 *   - list_sections          enumerate the 5 Bac sections (track values)
 *                            with pair counts — cheap discovery so the
 *                            agent can land an exact `track` filter
 *                            instead of guessing
 *   - list_exam_questions    scroll all sub-questions inside one exam,
 *                            optionally one exercise — closes the gap
 *                            where the student wants the full structure
 *                            of a specific exercise ("give me all
 *                            sub-questions of Exercice 4 in 2017
 *                            contrôle info math")
 *   - recall_analogy         pull a curated Tunisian real-life anchor for
 *                            a concept (Teacher Protocol step 4 / A12
 *                            *Dans la vraie vie* render block)
 *   - recall_pattern         pull the canonical thinking-frame for a
 *                            recurring BAC exercise genre — genre +
 *                            recipe + trap (Teacher Protocol steps
 *                            2-3 / A11 *Comment penser à ça* render
 *                            block)
 *   - emit_hint_ladder       structured 4-rung scaffold for problem-
 *                            shaped help requests (A1 Hint Ladder
 *                            render block) — forces progressive
 *                            disclosure instead of dumping the full
 *                            solution as prose
 *   - emit_solution_steps    structured numbered-card stack for full
 *                            worked solutions (A4 Stepwise Solution
 *                            Cards render block) — each card carries
 *                            title + LaTeX + justification + optional
 *                            common-mistake callout + optional
 *                            predict-next gate
 *
 * Two non-negotiable filters are baked into every Qdrant read inside
 * {@link QdrantClientProvider} (`critic_label='correct'`, `under_gate=false`),
 * so the LLM cannot accidentally pull quarantined or unverified content.
 *
 * Each tool catches its own errors and returns a JSON-encoded string
 * (success) or a plain-text error message — a misconfigured Qdrant /
 * Neo4j only degrades the affected tool, not the whole stream.
 */
@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);

  /** Qdrant recall fan-out used before reranking on `search_questions`. */
  private static readonly RECALL_FANOUT = 20;
  /** Default top-K returned by `search_questions` after rerank. */
  private static readonly DEFAULT_LIMIT = 5;
  /** Hard cap on `limit` so the agent can't blow up token budgets. */
  private static readonly MAX_LIMIT = 25;
  /** Truncate long French/LaTeX text in tool responses to keep prompts small. */
  private static readonly TEXT_PREVIEW_CHARS = 600;
  /** Soft ceiling on how many pairs `list_exam_questions` will ever return. */
  private static readonly LIST_EXAM_QUESTIONS_MAX = 100;
  /** Default page size for `list_exam_questions`. */
  private static readonly LIST_EXAM_QUESTIONS_DEFAULT = 30;
  /** Hard cap on the Qdrant scroll backing `list_exam_questions` — the
   *  largest exam in the corpus has ~30 sub-questions, so 200 is safe. */
  private static readonly LIST_EXAM_QUESTIONS_SCROLL_CAP = 200;

  constructor(
    private readonly qdrant: QdrantClientProvider,
    private readonly neo4j: Neo4jClientProvider,
    private readonly embeddings: EmbeddingsClient,
    private readonly reranker: RerankerClient,
    private readonly analogies: AnalogiesClient,
    private readonly patterns: PatternsClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * Public CDN base URL for image relpaths returned by the agent.
   * Optional — when unset, image fields fall back to raw relpath
   * strings so the frontend can compose its own URL or display a
   * "no asset" state. Set as `IMAGE_CDN_BASE` (e.g. Cloudflare R2,
   * Bunny, or any static-asset host).
   */
  private get imageCdnBase(): string | undefined {
    return this.config.get<string>('IMAGE_CDN_BASE');
  }

  getAll(): StructuredToolInterface[] {
    return [
      this.searchQuestionsTool(),
      this.getQuestionPairTool(),
      this.findSimilarQuestionsTool(),
      this.countQuestionsTool(),
      this.listChaptersTool(),
      this.listTopicsTool(),
      this.listExamsTool(),
      this.listSectionsTool(),
      this.listExamQuestionsTool(),
      this.recallAnalogyTool(),
      this.recallPatternTool(),
      this.emitHintLadderTool(),
      this.emitSolutionStepsTool(),
      this.writeTodosTool(),
    ];
  }

  // ---- write_todos ------------------------------------------------------

  /**
   * Planning capability — modeled after deepagents / langchain
   * `TodoListMiddleware`. The LLM emits the full intended task list (each
   * item carries a status: pending / in_progress / completed) and the UI
   * renders it as a live "plan panel" above the chat transcript so the
   * student can watch progress in real time.
   *
   * The tool itself is intentionally a no-op on the server side: the
   * authoritative state is the latest `tool-input-available` event for
   * `write_todos` on the wire, which the frontend reads off the message
   * stream. We don't keep todos in LangGraph state because (a) we already
   * stream every tool input/output through {@link ChatService}, and (b)
   * persisting them as part of the dual-written `messages` table would
   * couple the planning surface to the history schema for no benefit.
   */
  private writeTodosTool(): StructuredToolInterface {
    return tool(
      async ({ todos }) => {
        return JSON.stringify({ ok: true, count: todos.length });
      },
      {
        name: 'write_todos',
        description: WRITE_TODOS_TOOL_DESCRIPTION,
        schema: z.object({
          todos: z
            .array(
              z.object({
                content: z
                  .string()
                  .min(1)
                  .describe(
                    'Specific, actionable task description (one sentence).',
                  ),
                status: z
                  .enum(['pending', 'in_progress', 'completed'])
                  .describe(
                    'Current status. Mark in_progress before starting and ' +
                      'completed immediately after finishing — do not batch.',
                  ),
              }),
            )
            .describe(
              'The full ordered todo list. Each call replaces the previous ' +
                'list, so always include items already marked completed so ' +
                'their status is preserved.',
            ),
        }),
      },
    );
  }

  // ---- emit_hint_ladder -------------------------------------------------

  /**
   * Pedagogical scaffold for problem-shaped help requests (A1 Hint
   * Ladder). The agent emits four progressively-richer hints — a
   * tiny nudge, the technique name, the first move of the working,
   * and the full solution — and the frontend renders them as a
   * stacked accordion the student opens at their own pace.
   *
   * Like {@link writeTodosTool}, this is a no-op on the server. The
   * authoritative state lives on the wire as the
   * `tool-emit_hint_ladder` part input — the frontend reads
   * `part.input.rungs` and `part.input.problem_summary` directly off
   * the message stream. We don't need a server-side response, so the
   * tool just echoes the count back to keep the agent loop happy.
   */
  private emitHintLadderTool(): StructuredToolInterface {
    return tool(
      async ({ rungs }) => {
        return JSON.stringify({
          ok: true,
          rung_count: Object.values(rungs).filter(
            (r) => typeof r === 'string' && r.length > 0,
          ).length,
        });
      },
      {
        name: 'emit_hint_ladder',
        description: EMIT_HINT_LADDER_TOOL_DESCRIPTION,
        schema: z.object({
          problem_summary: z
            .string()
            .min(1)
            .describe(
              'One short sentence describing the problem the ladder is ' +
                'about (used as the chip header). Match the student’s ' +
                'language. Example: "Mettre 1 + i√3 sous forme exponentielle."',
            ),
          rungs: z
            .object({
              tiny_nudge: z
                .string()
                .min(1)
                .describe(
                  'ONE-sentence steer that points at the key observation ' +
                    'WITHOUT naming the technique. Example: "Look at the ' +
                    'modulus before the argument."',
                ),
              technique: z
                .string()
                .min(1)
                .describe(
                  'One or two sentences naming the high-level approach by ' +
                    'name. Example: "Use the trigonometric / exponential ' +
                    'form of complex numbers."',
                ),
              first_move: z
                .string()
                .min(1)
                .describe(
                  'The first concrete line of working only — the setup of ' +
                    'the equation, the first integration step, the first ' +
                    'recurrence call. Stop after that line.',
                ),
              full_solution: z
                .string()
                .min(1)
                .describe(
                  'The complete worked solution in LaTeX. Use numbered ' +
                    'steps when helpful. The frontend de-emphasises this ' +
                    'rung visually so the student is nudged to try the ' +
                    'smaller rungs first.',
                ),
            })
            .describe(
              'Four progressively-richer hints. Emit all four every time — ' +
                'the gradient of help is the whole point of this tool.',
            ),
        }),
      },
    );
  }

  // ---- emit_solution_steps ----------------------------------------------

  /**
   * Pedagogical scaffold for full worked solutions (A4 Stepwise
   * Solution Cards). The agent emits a numbered stack of step cards
   * — each carrying its own LaTeX, justification, and optional
   * common-mistake callout — and the frontend renders them folded
   * by default. The student opens cards one at a time instead of
   * scanning a wall of LaTeX. Some cards can flag `predict_next:
   * true` to hide the following card behind a "Predict the next
   * step" gate, the highest-leverage active-recall move available.
   *
   * Like {@link writeTodosTool} and {@link emitHintLadderTool}, this
   * is a no-op on the server. The authoritative state lives on the
   * wire as the `tool-emit_solution_steps` part input — the
   * frontend reads `part.input.steps` directly off the message
   * stream. The server-side function just echoes a count back to
   * keep the agent loop happy.
   */
  private emitSolutionStepsTool(): StructuredToolInterface {
    return tool(
      async ({ steps }) => {
        return JSON.stringify({ ok: true, step_count: steps.length });
      },
      {
        name: 'emit_solution_steps',
        description: EMIT_SOLUTION_STEPS_TOOL_DESCRIPTION,
        schema: z.object({
          problem_summary: z
            .string()
            .min(1)
            .describe(
              'One short sentence describing the exercise the cards solve ' +
                '(used as the stack header). Match the student’s ' +
                'language. Example: "Résoudre $z^2 = -4$ dans $\\mathbb{C}$."',
            ),
          steps: z
            .array(
              z.object({
                title: z
                  .string()
                  .min(1)
                  .describe(
                    'Short verb phrase naming what the step accomplishes ' +
                      '("Mettre $z$ sous forme exponentielle"). NO ' +
                      'numbering — the frontend prepends "Étape N".',
                  ),
                latex: z
                  .string()
                  .min(1)
                  .describe(
                    'The actual working line(s) for this step, in LaTeX. ' +
                      'Inline math: $...$, display: $$...$$. One step = ' +
                      'one tightly-related working block, not a whole ' +
                      'sub-derivation.',
                  ),
                justification: z
                  .string()
                  .min(1)
                  .describe(
                    'One or two sentences explaining *why* this step ' +
                      'works — the rule, theorem, or observation that ' +
                      'licences the move.',
                  ),
                common_mistake: z
                  .string()
                  .optional()
                  .describe(
                    'Optional. The typical Tunisian-BAC trap on this ' +
                      'step. Omit when the step has no notable trap.',
                  ),
                predict_next: z
                  .boolean()
                  .optional()
                  .describe(
                    'Optional. Set to true when the next move is ' +
                      'something the student should be able to predict ' +
                      'from what is already on screen. The frontend ' +
                      'hides the following card behind a "Predict the ' +
                      'next step" gate. Use sparingly (1-2 gates total) ' +
                      'and never on the last step.',
                  ),
              }),
            )
            .min(2)
            .describe(
              'Ordered list of step cards. 3-8 is the sweet spot. ' +
                'Order matters — the frontend auto-numbers in array order.',
            ),
        }),
      },
    );
  }

  // ---- search_questions -------------------------------------------------

  private searchQuestionsTool(): StructuredToolInterface {
    return tool(
      async (args) => {
        try {
          const filter = this.buildQdrantFilterFromArgs(args);
          const limit = this.clampLimit(args.limit);
          const vector = await this.embeddings.embed(args.query);

          const candidates = await this.qdrant.searchDense({
            vector,
            limit: AgentToolsService.RECALL_FANOUT,
            filter,
          });
          if (candidates.length === 0) {
            return JSON.stringify({ results: [] });
          }

          const reranked = await this.reranker.rerank({
            query: args.query,
            passages: candidates,
            getText: (p) => formatRerankPassage(p),
            topK: limit,
          });

          const cdnBase = this.imageCdnBase;
          return JSON.stringify({
            results: reranked.map((p) => formatPairForLLM(p, { cdnBase })),
          });
        } catch (err) {
          this.logger.warn(`search_questions failed: ${String(err)}`);
          return `Error searching questions: ${(err as Error).message}`;
        }
      },
      {
        name: 'search_questions',
        description:
          'Semantic search over the Tunisian Baccalaureate Q/A corpus. ' +
          'Embeds the query, retrieves candidates from Qdrant with the ' +
          'requested metadata filters, and reranks with a cross-encoder. ' +
          'Returns past exam questions matching the query. Results always ' +
          'have critic_label="correct" and are not under quality gate.',
        schema: z.object({
          query: z
            .string()
            .describe(
              'Natural-language query (FR or EN), e.g. "complex numbers ' +
                'modulus problems" or "exercices sur les équations diophantiennes".',
            ),
          matiere: z
            .enum([
              'math',
              'physique',
              'svt',
              'gestion',
              'technique',
              'bd',
              'economie',
              'info',
              'algorithme',
            ])
            .optional()
            .describe('Subject filter (Tunisian Bac matière names).'),
          chapter: z
            .string()
            .optional()
            .describe(
              'Chapter name (exact match), e.g. "Arithmétique", "Nombres complexes".',
            ),
          topic: z
            .string()
            .optional()
            .describe(
              'Topic tag (exact match against the topics array), e.g. "PGCD".',
            ),
          year: z
            .number()
            .int()
            .min(2000)
            .max(2100)
            .optional()
            .describe('Exam year (e.g. 2017).'),
          session: z
            .enum(['principale', 'controle'])
            .optional()
            .describe(
              'Exam session — principale (June) or controle (September retake).',
            ),
          track: z
            .enum(SECTION_ENUM)
            .optional()
            .describe(
              'Bac **section** (also called "track"). One of the 5 ' +
                'Tunisian Bac sections: sciences-ex (sciences expérimentales), ' +
                'math (mathématiques), technique (sciences techniques), ' +
                'informatique (sciences informatique), economie-gestion ' +
                '(économie et gestion). Pass this whenever the student ' +
                'names or implies a specific section — a request shaped like ' +
                '"fel section science..." / "in section sciences..." / ' +
                '"section maths" must always be filtered by section, ' +
                'otherwise results leak across tracks. If unsure of the ' +
                'canonical code, call list_sections first.',
            ),
          exam: z
            .string()
            .optional()
            .describe(
              'Specific exam_id, e.g. "2017_controle_informatique_math". ' +
                'Format: {year}_{session}_{track}_{matiere}.',
            ),
          difficulty_min: z
            .number()
            .int()
            .optional()
            .describe('Inclusive lower bound on difficulty (1=easy, 3=hard).'),
          difficulty_max: z
            .number()
            .int()
            .optional()
            .describe('Inclusive upper bound on difficulty (1=easy, 3=hard).'),
          bloom_level: z
            .string()
            .optional()
            .describe(
              "Bloom's taxonomy level: knowledge, comprehension, application, analysis, synthesis, evaluation.",
            ),
          answer_format: z
            .string()
            .optional()
            .describe('Expected answer format, e.g. "list", "short", "long".'),
          requires_figure: z
            .boolean()
            .optional()
            .describe(
              'If true, only return questions that require a figure/diagram.',
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(AgentToolsService.MAX_LIMIT)
            .optional()
            .describe(
              `Top-K after rerank (default ${AgentToolsService.DEFAULT_LIMIT}, max ${AgentToolsService.MAX_LIMIT}).`,
            ),
        }),
      },
    );
  }

  // ---- get_question_pair ------------------------------------------------

  private getQuestionPairTool(): StructuredToolInterface {
    return tool(
      async ({ pair_id }) => {
        try {
          const point = await this.qdrant.getByPairId(pair_id);
          if (!point) {
            return `No question pair found for pair_id="${pair_id}".`;
          }
          return JSON.stringify(
            formatPairForLLM(point, {
              full: true,
              cdnBase: this.imageCdnBase,
            }),
          );
        } catch (err) {
          this.logger.warn(`get_question_pair failed: ${String(err)}`);
          return `Error fetching question pair: ${(err as Error).message}`;
        }
      },
      {
        name: 'get_question_pair',
        description:
          'Fetch the full content (question text, full corrigé/answer text, ' +
          'and metadata) for a specific Bac Q/A pair by its pair_id. Use this ' +
          'after search_questions or find_similar_questions to retrieve the ' +
          'complete answer when the truncated preview is not enough.',
        schema: z.object({
          pair_id: z
            .string()
            .describe(
              'The pair_id, e.g. "math-2017-controle-informatique:ex_4:q_1.c". ' +
                'Pair ids returned by search_questions / find_similar_questions / ' +
                'list_exam_questions are the canonical handle.',
            ),
        }),
      },
    );
  }

  // ---- find_similar_questions ------------------------------------------

  private findSimilarQuestionsTool(): StructuredToolInterface {
    return tool(
      async ({ pair_id, limit, matiere }) => {
        try {
          const seed = await this.qdrant.getByPairId(pair_id);
          if (!seed) {
            return `Cannot find seed pair "${pair_id}" — has it been deleted or moved?`;
          }
          const k = this.clampLimit(limit);
          const filter: QdrantFilter | undefined = matiere
            ? { must: [{ key: 'matiere', match: { value: matiere } }] }
            : undefined;
          // Ask for k+1 because Qdrant returns the seed itself as result #1.
          const points = await this.qdrant.findSimilarById({
            pointId: seed.id,
            limit: k + 1,
            filter,
          });
          const cdnBase = this.imageCdnBase;
          const results = points
            .filter(
              (p) =>
                readStringPayload(p, 'pair_id_logical') !== pair_id &&
                readStringPayload(p, 'pair_id') !== pair_id,
            )
            .slice(0, k)
            .map((p) => formatPairForLLM(p, { cdnBase }));
          return JSON.stringify({ seed: pair_id, results });
        } catch (err) {
          this.logger.warn(`find_similar_questions failed: ${String(err)}`);
          return `Error finding similar questions: ${(err as Error).message}`;
        }
      },
      {
        name: 'find_similar_questions',
        description:
          'Given a known pair_id, return the K most similar Bac questions ' +
          'by dense vector neighbourhood. Useful for "give me more like this" ' +
          'or building a topic-coherent practice set.',
        schema: z.object({
          pair_id: z.string().describe('The seed pair_id.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(AgentToolsService.MAX_LIMIT)
            .optional()
            .describe(
              `Number of neighbours to return (default ${AgentToolsService.DEFAULT_LIMIT}, max ${AgentToolsService.MAX_LIMIT}).`,
            ),
          matiere: z
            .enum([
              'math',
              'physique',
              'svt',
              'gestion',
              'technique',
              'bd',
              'economie',
              'info',
              'algorithme',
            ])
            .optional()
            .describe('Optional matière filter to keep neighbours on-subject.'),
        }),
      },
    );
  }

  // ---- count_questions --------------------------------------------------

  private countQuestionsTool(): StructuredToolInterface {
    return tool(
      async (args) => {
        try {
          const filter = this.buildQdrantFilterFromArgs(args);
          const count = await this.qdrant.count(filter);
          return JSON.stringify({ count });
        } catch (err) {
          this.logger.warn(`count_questions failed: ${String(err)}`);
          return `Error counting questions: ${(err as Error).message}`;
        }
      },
      {
        name: 'count_questions',
        description:
          'Count corrected, gate-passing Bac questions matching the given ' +
          'filters. Cheap (no embeddings, no reranker) — use this to answer ' +
          'aggregate questions like "how many trigonometry problems do you have?" ' +
          'before deciding whether to do an expensive search.',
        schema: z.object({
          matiere: z
            .enum([
              'math',
              'physique',
              'svt',
              'gestion',
              'technique',
              'bd',
              'economie',
              'info',
              'algorithme',
            ])
            .optional(),
          chapter: z.string().optional(),
          topic: z.string().optional(),
          year: z.number().int().optional(),
          session: z.enum(['principale', 'controle']).optional(),
          track: z
            .enum(SECTION_ENUM)
            .optional()
            .describe(
              'Bac section / track. One of: sciences-ex, math, technique, ' +
                'informatique, economie-gestion. Required whenever the ' +
                'student names or implies a specific Bac section.',
            ),
          exam: z.string().optional(),
          difficulty_min: z.number().int().optional(),
          difficulty_max: z.number().int().optional(),
          bloom_level: z.string().optional(),
          answer_format: z.string().optional(),
          requires_figure: z.boolean().optional(),
        }),
      },
    );
  }

  // ---- list_chapters ----------------------------------------------------

  private listChaptersTool(): StructuredToolInterface {
    return tool(
      async ({ matiere }) => {
        let session: ReturnType<typeof this.neo4j.openSession> | undefined;
        try {
          session = this.neo4j.openSession();
          // The chapter / topic / bloom / format taxonomy graph was only
          // ingested for the legacy v1 slice. v6's Neo4j ingest only created
          // (:Pair)-[:FROM_EXAM]->(:Exam), (:OF_MATIERE)->(:Matiere) and
          // (:OF_EXERCISE)->(:Exercise) — there is no :IN_CHAPTER on v6 Pair
          // nodes. We therefore intentionally do NOT filter by
          // ingest_version='omni_v6' here: that would return an empty list
          // and break catalogue discovery. The chapter taxonomy is shared
          // between v1 and v6 in the actual exam corpus, so v1's graph
          // remains the right source of truth until the v6 ingest is
          // extended to write the missing relationship types.
          const cypher = matiere
            ? `
                MATCH (p:Pair)-[:IN_CHAPTER]->(c:Chapter)
                WHERE c.matiere = $matiere
                  AND p.critic_label = 'correct'
                  AND p.under_gate = false
                RETURN c.name AS chapter, c.matiere AS matiere, count(p) AS pair_count
                ORDER BY pair_count DESC, chapter ASC
              `
            : `
                MATCH (p:Pair)-[:IN_CHAPTER]->(c:Chapter)
                WHERE p.critic_label = 'correct' AND p.under_gate = false
                RETURN c.name AS chapter, c.matiere AS matiere, count(p) AS pair_count
                ORDER BY matiere ASC, pair_count DESC, chapter ASC
              `;
          const params: Record<string, unknown> = matiere ? { matiere } : {};
          const result = await session.run(cypher, params);
          return JSON.stringify({
            chapters: result.records.map((r) => ({
              chapter: r.get('chapter'),
              matiere: r.get('matiere'),
              pair_count: toNumber(r.get('pair_count')),
            })),
          });
        } catch (err) {
          this.logger.warn(`list_chapters failed: ${String(err)}`);
          return `Error listing chapters: ${(err as Error).message}`;
        } finally {
          if (session) await session.close().catch(() => undefined);
        }
      },
      {
        name: 'list_chapters',
        description:
          'List all chapters in the Bac corpus, optionally filtered by ' +
          'matière, with pair counts. Use this to discover the chapter ' +
          'taxonomy for a subject before building a practice plan.',
        schema: z.object({
          matiere: z
            .enum([
              'math',
              'physique',
              'svt',
              'gestion',
              'technique',
              'bd',
              'economie',
              'info',
              'algorithme',
            ])
            .optional()
            .describe('Optional matière filter; omit to list all chapters.'),
        }),
      },
    );
  }

  // ---- list_topics ------------------------------------------------------

  private listTopicsTool(): StructuredToolInterface {
    return tool(
      async ({ matiere, chapter, limit }) => {
        let session: ReturnType<typeof this.neo4j.openSession> | undefined;
        try {
          session = this.neo4j.openSession();
          // See list_chapters: the v6 Neo4j ingest skipped the topic graph,
          // so filtering by ingest_version='omni_v6' would empty this list.
          // Read the shared v1 topic taxonomy as the source of truth.
          const where: string[] = [
            "p.critic_label = 'correct'",
            'p.under_gate = false',
          ];
          const params: Record<string, unknown> = {
            limit: this.clampLimit(limit, 50, 200),
          };
          let path = '(p:Pair)-[:HAS_TOPIC]->(t:Topic)';
          if (chapter) {
            path =
              '(p:Pair)-[:IN_CHAPTER]->(c:Chapter), (p)-[:HAS_TOPIC]->(t:Topic)';
            where.push('c.name = $chapter');
            params.chapter = chapter;
          }
          if (matiere) {
            where.push('t.matiere = $matiere');
            params.matiere = matiere;
          }
          const cypher = `
            MATCH ${path}
            WHERE ${where.join(' AND ')}
            RETURN t.name AS topic, t.matiere AS matiere, count(p) AS pair_count
            ORDER BY pair_count DESC, topic ASC
            LIMIT toInteger($limit)
          `;
          const result = await session.run(cypher, params);
          return JSON.stringify({
            topics: result.records.map((r) => ({
              topic: r.get('topic'),
              matiere: r.get('matiere'),
              pair_count: toNumber(r.get('pair_count')),
            })),
          });
        } catch (err) {
          this.logger.warn(`list_topics failed: ${String(err)}`);
          return `Error listing topics: ${(err as Error).message}`;
        } finally {
          if (session) await session.close().catch(() => undefined);
        }
      },
      {
        name: 'list_topics',
        description:
          'List topics covered by the Bac corpus, optionally scoped to a ' +
          'matière and/or chapter, ordered by how many pairs reference each ' +
          'topic. Useful for discovering exact topic names to feed into ' +
          'search_questions(topic=...).',
        schema: z.object({
          matiere: z
            .enum([
              'math',
              'physique',
              'svt',
              'gestion',
              'technique',
              'bd',
              'economie',
              'info',
              'algorithme',
            ])
            .optional(),
          chapter: z.string().optional(),
          limit: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe('Max topics to return (default 50, max 200).'),
        }),
      },
    );
  }

  // ---- list_exams -------------------------------------------------------

  private listExamsTool(): StructuredToolInterface {
    return tool(
      async ({ matiere, year, session: examSession, track, limit }) => {
        let session: ReturnType<typeof this.neo4j.openSession> | undefined;
        try {
          session = this.neo4j.openSession();
          // v6 Exam nodes use `matiere` + `filiere`; v1 Exam nodes use
          // `subject` + `track`. Coalesce so the catalogue surfaces both
          // slices and the agent doesn't see a 50% drop the second the
          // collection switches over.
          const where: string[] = [];
          const params: Record<string, unknown> = {
            limit: this.clampLimit(limit, 50, 200),
          };
          if (matiere) {
            where.push('coalesce(e.matiere, e.subject) = $matiere');
            params.matiere = matiere;
          }
          if (year !== undefined && year !== null) {
            where.push('e.year = $year');
            params.year = year;
          }
          if (examSession) {
            where.push('e.session = $session');
            params.session = examSession;
          }
          if (track) {
            const normalisedTrack = normalizeSection(track);
            if (normalisedTrack) {
              where.push('coalesce(e.filiere, e.track) = $track');
              params.track = normalisedTrack;
            }
          }
          const whereClause = where.length
            ? `WHERE ${where.join(' AND ')}`
            : '';
          const cypher = `
            MATCH (e:Exam)
            ${whereClause}
            OPTIONAL MATCH (p:Pair)-[:FROM_EXAM]->(e)
              WHERE p.critic_label = 'correct' AND p.under_gate = false
            WITH e, count(p) AS pair_count
            RETURN
              e.exam_id AS exam_id,
              e.year    AS year,
              e.session AS session,
              coalesce(e.matiere, e.subject) AS subject,
              coalesce(e.filiere, e.track)   AS track,
              pair_count
            ORDER BY year DESC, subject ASC, session ASC
            LIMIT toInteger($limit)
          `;
          const result = await session.run(cypher, params);
          return JSON.stringify({
            exams: result.records.map((r) => ({
              exam_id: r.get('exam_id'),
              year: toNumber(r.get('year')),
              session: r.get('session'),
              subject: r.get('subject'),
              track: r.get('track'),
              pair_count: toNumber(r.get('pair_count')),
            })),
          });
        } catch (err) {
          this.logger.warn(`list_exams failed: ${String(err)}`);
          return `Error listing exams: ${(err as Error).message}`;
        } finally {
          if (session) await session.close().catch(() => undefined);
        }
      },
      {
        name: 'list_exams',
        description:
          'List Bac exams (year × session × subject × track) optionally ' +
          'filtered, each with a count of corrected gate-passing pairs. Use ' +
          'this to ground "how was the 2019 math controle structured?"-style ' +
          'questions before searching specific items.',
        schema: z.object({
          matiere: z
            .enum([
              'math',
              'physique',
              'svt',
              'gestion',
              'technique',
              'bd',
              'economie',
              'info',
              'algorithme',
            ])
            .optional(),
          year: z.number().int().optional(),
          session: z.enum(['principale', 'controle']).optional(),
          track: z
            .enum(SECTION_ENUM)
            .optional()
            .describe(
              'Bac section / track. One of: sciences-ex, math, technique, ' +
                'informatique, economie-gestion. Pass this when the student ' +
                'names a section.',
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe('Max exams to return (default 50, max 200).'),
        }),
      },
    );
  }

  // ---- list_sections ----------------------------------------------------

  /**
   * Discovery tool over the 5 Tunisian Bac sections (a.k.a. tracks).
   * Returns the canonical short codes (`sciences-ex`, `math`, `technique`,
   * `informatique`, `economie-gestion`) with pair counts so the agent
   * can pick an exact `track` filter instead of guessing from natural
   * language. Cheap (one Cypher aggregate, no embeddings).
   *
   * The student-facing names are encoded in the `description` field so
   * the agent can answer "section sciences" → `sciences-ex`,
   * "section maths" → `math`, "BAC techniques" → `technique`, etc.,
   * without rote memorisation of the mapping.
   */
  private listSectionsTool(): StructuredToolInterface {
    return tool(
      async () => {
        let session: ReturnType<typeof this.neo4j.openSession> | undefined;
        try {
          session = this.neo4j.openSession();
          // v6 Exam nodes carry `filiere` but not `track`, while v1 Exam
          // nodes carry `track` but not `filiere`. Coalesce the two so the
          // section facet works across both slices, then normalise v1's
          // underscored values to v6's hyphenated form so the agent gets
          // one consistent set of section codes.
          const cypher = `
            MATCH (p:Pair)-[:FROM_EXAM]->(e:Exam)
            WHERE p.critic_label = 'correct' AND p.under_gate = false
              AND coalesce(e.filiere, e.track) IS NOT NULL
            WITH coalesce(e.filiere, e.track) AS section, p
            RETURN section, count(p) AS pair_count
            ORDER BY pair_count DESC, section ASC
          `;
          const result = await session.run(cypher);
          // Aggregate after normalisation so v1's `sciences_ex` (underscored)
          // and v6's `sciences-ex` (hyphenated) collapse onto the same row.
          const counts = new Map<string, number>();
          for (const r of result.records) {
            const raw = r.get('section') as string;
            const code = normalizeSection(raw) ?? raw;
            counts.set(
              code,
              (counts.get(code) ?? 0) + toNumber(r.get('pair_count')),
            );
          }
          const sections = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([code, pair_count]) => ({
              section: code,
              pair_count,
              description: SECTION_DESCRIPTIONS[code] ?? null,
            }));
          return JSON.stringify({ sections });
        } catch (err) {
          this.logger.warn(`list_sections failed: ${String(err)}`);
          return `Error listing sections: ${(err as Error).message}`;
        } finally {
          if (session) await session.close().catch(() => undefined);
        }
      },
      {
        name: 'list_sections',
        description:
          'List the 5 Tunisian Bac **sections** (also called "tracks") ' +
          'with the count of corrected, gate-passing pairs in each. ' +
          'Use this whenever the student names a Bac section ("section ' +
          'science", "BAC math", "section informatique", "éco-gestion", ' +
          'etc.) and you are not sure which canonical code (e.g. ' +
          '`sciences-ex`, `math`, `technique`) to pass to the `track` ' +
          'filter on search_questions / count_questions / list_exams. ' +
          'Cheap (one aggregate query, no embeddings).',
        schema: z.object({}),
      },
    );
  }

  // ---- list_exam_questions ---------------------------------------------

  /**
   * Scroll all corrected sub-questions inside a specific Bac exam,
   * optionally restricted to a single exercise number. Closes the gap
   * where the student wants the full structure of a specific exercise
   * ("déroule-moi tout l'Exercice 4 du 2017 contrôle info math") — a
   * vector search returns top-K relevant pairs, never the full ordered
   * list, and the existing catalogue tools (list_chapters / list_exams)
   * stop one level above the per-question grain.
   *
   * Implementation note: only `exam` is indexed in Qdrant
   * (`exercise_number` is an unindexed payload field), so we scroll on
   * `exam` and filter by `exercise_number` in Node. The largest exam in
   * the corpus has < 30 sub-questions, well under the scroll cap.
   */
  private listExamQuestionsTool(): StructuredToolInterface {
    return tool(
      async ({ exam, exercise_number, limit }) => {
        try {
          const points = await this.qdrant.scrollByFilter({
            filter: {
              must: [{ key: 'exam', match: { value: exam } }],
            },
            limit: AgentToolsService.LIST_EXAM_QUESTIONS_SCROLL_CAP,
          });
          let filtered = points;
          if (typeof exercise_number === 'number') {
            filtered = points.filter((p) => {
              const ex = (p.payload ?? {}).exercise_number;
              return typeof ex === 'number' && ex === exercise_number;
            });
          }
          const sorted = [...filtered].sort((a, b) => {
            const ea = numberPayload(a, 'exercise_number') ?? 0;
            const eb = numberPayload(b, 'exercise_number') ?? 0;
            if (ea !== eb) return ea - eb;
            const qa = String((a.payload ?? {}).question_number ?? '');
            const qb = String((b.payload ?? {}).question_number ?? '');
            return qa.localeCompare(qb, undefined, { numeric: true });
          });
          const cap = this.clampLimit(
            limit,
            AgentToolsService.LIST_EXAM_QUESTIONS_DEFAULT,
            AgentToolsService.LIST_EXAM_QUESTIONS_MAX,
          );
          const exercises = uniqueExerciseNumbers(sorted);
          return JSON.stringify({
            exam,
            ...(typeof exercise_number === 'number' && { exercise_number }),
            total: sorted.length,
            truncated: sorted.length > cap,
            exercises,
            questions: sorted
              .slice(0, cap)
              .map((p) => formatPairForLLM(p, { cdnBase: this.imageCdnBase })),
          });
        } catch (err) {
          this.logger.warn(`list_exam_questions failed: ${String(err)}`);
          return `Error listing exam questions: ${(err as Error).message}`;
        }
      },
      {
        name: 'list_exam_questions',
        description:
          'List **all** corrected sub-questions inside a specific Bac ' +
          'exam, optionally restricted to a single exercise. Returns ' +
          'the questions in canonical order (by exercise_number then ' +
          'question_number). Use this when the student asks "give me ' +
          'all the sub-questions of Exercice 4", "déroule-moi tout ' +
          'l\'énoncé", "liste les questions de cet exercice" — a vector ' +
          'search returns top-K, not the full ordered structure. ' +
          'Cheap (Qdrant scroll on the indexed `exam` field; no ' +
          'embeddings, no rerank).',
        schema: z.object({
          exam: z
            .string()
            .min(1)
            .describe(
              'The exam_id (format `{year}_{session}_{track}_{matiere}`), ' +
                'e.g. "2017_controle_informatique_math". Use list_exams ' +
                'to discover valid ids when needed.',
            ),
          exercise_number: z
            .number()
            .int()
            .optional()
            .describe(
              'Optional. Restrict to a single exercise (e.g. 4 for ' +
                '"Exercice 4"). Omit to list every sub-question across ' +
                'every exercise in the exam.',
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(AgentToolsService.LIST_EXAM_QUESTIONS_MAX)
            .optional()
            .describe(
              `Max questions to return (default ${AgentToolsService.LIST_EXAM_QUESTIONS_DEFAULT}, max ${AgentToolsService.LIST_EXAM_QUESTIONS_MAX}). The "total" field always reflects the unsliced count.`,
            ),
        }),
      },
    );
  }

  // ---- recall_analogy ---------------------------------------------------

  /**
   * Curated Tunisian real-life anchor for a math/physique/svt/etc.
   * concept. This is step 4 of the Teacher Protocol (RECALL anchor) —
   * the agent pulls a hand-curated analogy from the on-disk library
   * BEFORE composing its reply. The frontend renders the result as the
   * A12 *Dans la vraie vie* chip (see product-vision SKILL.md Part E.3).
   *
   * The tool is intentionally honest: when the library doesn't cover
   * the concept it returns `{ covered: false }`. The system prompt
   * forbids fabricating an anchor in that case — better to skip the
   * chip than pollute it with a generic "imagine a pizza" analogy that
   * defeats the whole point of being a Tunisian-specific moat.
   */
  private recallAnalogyTool(): StructuredToolInterface {
    return tool(
      async ({ concept_query, matiere }) => {
        try {
          const anchor = this.analogies.recall({
            query: concept_query,
            matiere,
          });
          if (!anchor) {
            return JSON.stringify({
              covered: false,
              concept_query,
            });
          }
          return JSON.stringify({
            covered: true,
            anchor: {
              id: anchor.id,
              concept_label: anchor.concept_label,
              matiere: anchor.matiere,
              label: anchor.label,
              short: anchor.short,
              full: anchor.full,
              language: anchor.language,
              tags: anchor.tags,
            },
          });
        } catch (err) {
          this.logger.warn(`recall_analogy failed: ${String(err)}`);
          return `Error recalling analogy: ${(err as Error).message}`;
        }
      },
      {
        name: 'recall_analogy',
        description:
          'Pull a curated Tunisian real-life analogy for the concept ' +
          'currently being taught. Call this BEFORE writing the main ' +
          'explanation when the student is asking about a concrete ' +
          'mathematical/physical/biological concept that benefits from ' +
          'grounding (e.g. "fonction affine", "forme exponentielle", ' +
          '"mitose", "loi de Newton", "clé étrangère"). The library is ' +
          'small and curated — if no match is found, the tool returns ' +
          '`covered: false` and you must NOT invent an analogy yourself: ' +
          'just continue with the explanation without an analogy chip.',
        schema: z.object({
          concept_query: z
            .string()
            .min(2)
            .describe(
              'Short label for the concept being taught, in French or ' +
                'English. Examples: "fonction affine", "forme exponentielle", ' +
                '"mitose", "deuxième loi de Newton", "clé étrangère SQL".',
            ),
          matiere: z
            .enum([
              'math',
              'physique',
              'svt',
              'gestion',
              'technique',
              'bd',
              'economie',
              'info',
              'algorithme',
            ])
            .optional()
            .describe(
              'Matière filter. When provided, only anchors tagged with ' +
                'this matière are eligible — useful when the same word ' +
                '(e.g. "limite") could match different concepts across ' +
                'subjects.',
            ),
        }),
      },
    );
  }

  // ---- recall_pattern ---------------------------------------------------

  /**
   * Curated thinking-frame for a recurring BAC exercise genre. This is
   * steps 2 and 3 of the Teacher Protocol (RECALL the recipe / RECALL
   * the trap) — the agent pulls a hand-curated genre + canonical
   * recipe + typical trap from the on-disk Pattern Atlas BEFORE
   * composing its reply. The frontend renders the result as the A11
   * *Comment penser à ça* card pinned at the top of the assistant's
   * turn (see product-vision SKILL.md Part E.1).
   *
   * The tool is intentionally honest: when the atlas doesn't cover
   * the topic it returns `{ covered: false }`. The system prompt
   * forbids fabricating a recipe in that case — better to skip the
   * card than make up a generic "step 1: read the question" recipe
   * that defeats the whole point of being a Tunisian-BAC-specific
   * moat.
   */
  private recallPatternTool(): StructuredToolInterface {
    return tool(
      async ({ concept_query, matiere }) => {
        try {
          const pattern = this.patterns.recall({
            query: concept_query,
            matiere,
          });
          if (!pattern) {
            return JSON.stringify({
              covered: false,
              concept_query,
            });
          }
          return JSON.stringify({
            covered: true,
            pattern: {
              id: pattern.id,
              topic_label: pattern.topic_label,
              matiere: pattern.matiere,
              frequency_in_bac: pattern.frequency_in_bac,
              genre: pattern.genre,
              recipe: pattern.recipe,
              trap: pattern.trap,
              typical_framings: pattern.typical_framings,
              variations: pattern.variations,
            },
          });
        } catch (err) {
          this.logger.warn(`recall_pattern failed: ${String(err)}`);
          return `Error recalling pattern: ${(err as Error).message}`;
        }
      },
      {
        name: 'recall_pattern',
        description:
          'Pull the canonical thinking-frame for a recurring BAC ' +
          'exercise genre — what *type* of exercise it is, the ' +
          '3-step canonical procedure to solve it, and the typical ' +
          'trap markers look for. Call this BEFORE writing your ' +
          'main explanation when the student asks about a concept ' +
          'that maps to a known recurring exercise type (e.g. ' +
          '"forme exponentielle", "suite géométrique", "dipôle RC", ' +
          '"mitose", "recherche dichotomique"). The atlas is small ' +
          'and curated — if no match is found, the tool returns ' +
          '`covered: false` and you must NOT invent a recipe ' +
          'yourself: just continue with the explanation without a ' +
          'thinking-frame card.',
        schema: z.object({
          concept_query: z
            .string()
            .min(2)
            .describe(
              'Short label for the exercise genre / topic, in French ' +
                'or English. Examples: "forme exponentielle", "suite ' +
                'géométrique", "intégration par parties", "dipôle RC ' +
                'charge", "mitose", "recherche dichotomique", "clé ' +
                'étrangère SQL".',
            ),
          matiere: z
            .enum([
              'math',
              'physique',
              'svt',
              'gestion',
              'technique',
              'bd',
              'economie',
              'info',
              'algorithme',
            ])
            .optional()
            .describe(
              'Matière filter. When provided, only patterns tagged ' +
                'with this matière are eligible — useful when the ' +
                'same word (e.g. "limite") could match different ' +
                'concepts across subjects.',
            ),
        }),
      },
    );
  }

  // ---- helpers ----------------------------------------------------------

  private clampLimit(
    requested: number | undefined,
    fallback: number = AgentToolsService.DEFAULT_LIMIT,
    cap: number = AgentToolsService.MAX_LIMIT,
  ): number {
    if (typeof requested !== 'number' || !Number.isFinite(requested)) {
      return fallback;
    }
    return Math.max(1, Math.min(cap, Math.floor(requested)));
  }

  /**
   * Build a Qdrant filter from a flat object of agent-supplied options.
   * Only the optional filters live here — the mandatory `critic_label` /
   * `under_gate` clauses are injected inside the Qdrant client.
   */
  private buildQdrantFilterFromArgs(args: {
    matiere?: string;
    chapter?: string;
    topic?: string;
    year?: number;
    session?: string;
    track?: string;
    exam?: string;
    difficulty_min?: number;
    difficulty_max?: number;
    bloom_level?: string;
    answer_format?: string;
    requires_figure?: boolean;
  }): QdrantFilter | undefined {
    const must: QdrantCondition[] = [];
    if (args.matiere)
      must.push({ key: 'matiere', match: { value: args.matiere } });
    if (args.chapter)
      must.push({ key: 'chapter', match: { value: args.chapter } });
    if (args.topic) must.push({ key: 'topics', match: { value: args.topic } });
    if (args.year !== undefined)
      must.push({ key: 'year', match: { value: args.year } });
    if (args.session)
      must.push({ key: 'session', match: { value: args.session } });
    if (args.track) {
      const track = normalizeSection(args.track);
      if (track) must.push({ key: 'track', match: { value: track } });
    }
    if (args.exam) must.push({ key: 'exam', match: { value: args.exam } });
    if (args.bloom_level)
      must.push({ key: 'bloom_level', match: { value: args.bloom_level } });
    if (args.answer_format)
      must.push({ key: 'answer_format', match: { value: args.answer_format } });
    if (typeof args.requires_figure === 'boolean') {
      must.push({
        key: 'requires_figure',
        match: { value: args.requires_figure },
      });
    }
    if (
      typeof args.difficulty_min === 'number' ||
      typeof args.difficulty_max === 'number'
    ) {
      const range: { gte?: number; lte?: number } = {};
      if (typeof args.difficulty_min === 'number')
        range.gte = args.difficulty_min;
      if (typeof args.difficulty_max === 'number')
        range.lte = args.difficulty_max;
      must.push({ key: 'difficulty', range });
    }
    return must.length ? { must } : undefined;
  }
}

// ---- formatting helpers (module-private) -------------------------------

/**
 * Compose a public asset URL from a v6 image relpath. When
 * `cdnBase` is set (typically `IMAGE_CDN_BASE` env var pointing at
 * Cloudflare R2 / Bunny / S3), `relpath` is appended; otherwise we
 * return the raw relpath so the frontend can compose its own URL or
 * fall back to a "no asset" state without crashing.
 */
function buildImageUrl(
  relpath: unknown,
  cdnBase: string | undefined,
): string | null {
  if (typeof relpath !== 'string' || relpath.length === 0) return null;
  if (!cdnBase) return relpath;
  return `${cdnBase.replace(/\/+$/, '')}/${relpath.replace(/^\/+/, '')}`;
}

/**
 * Translate a Qdrant v6 point into the JSON the agent (and downstream
 * frontend) consumes. Surfaces both legacy v1-named fields (kept for
 * back-compat with any in-flight conversation state) AND v6-native
 * fields (image relpaths, source pages, figure counts, exam ids,
 * has_answer). Mirrors the Python reference impl
 * `serialize_hit_for_api` in `agent_helpers_v6.py`.
 *
 * `pair_id` is the canonical handle the agent passes around between
 * tool calls. v6 stores it as `pair_id_logical`; we also fall back to
 * the v1 `pair_id` payload key for safety during the cutover window.
 */
function formatPairForLLM(
  point: QdrantPoint,
  opts?: { full?: boolean; cdnBase?: string },
): Record<string, unknown> {
  const payload = (point.payload ?? {}) as Record<string, unknown>;
  const question = readStringPayload(point, 'question_text') ?? '';
  const answer = readStringPayload(point, 'answer_text') ?? '';
  const cap = AgentToolsService['TEXT_PREVIEW_CHARS'] as number;
  const cdnBase = opts?.cdnBase;
  const pairId = payload.pair_id_logical ?? payload.pair_id ?? null;
  return {
    pair_id: pairId,
    matiere: payload.matiere ?? null,
    chapter: payload.chapter ?? null,
    exam: payload.exam ?? null,
    exam_id: payload.exam_id ?? null,
    exercise_id_global: payload.exercise_id_global ?? null,
    year: payload.year ?? payload.exam_year ?? null,
    session: payload.session ?? null,
    track: payload.track ?? payload.filiere ?? null,
    exercise_number: payload.exercise_number ?? null,
    question_number: payload.question_number ?? null,
    difficulty: payload.difficulty ?? null,
    bloom_level: payload.bloom_level ?? null,
    answer_format: payload.answer_format ?? null,
    requires_figure: payload.requires_figure ?? null,
    has_answer: payload.has_answer ?? null,
    has_figure_enonce: payload.has_figure_enonce ?? null,
    has_figure_corrige: payload.has_figure_corrige ?? null,
    n_enonce_figures: payload.n_enonce_figures ?? null,
    n_corrige_figures: payload.n_corrige_figures ?? null,
    source_pages_enonce: payload.source_pages_enonce ?? [],
    source_pages_corrige: payload.source_pages_corrige ?? [],
    topics: payload.topics ?? [],
    keywords_fr: payload.keywords_fr ?? [],
    question_text: opts?.full ? question : truncate(question, cap),
    answer_text: opts?.full ? answer : truncate(answer, cap),
    images: {
      exercise_enonce: buildImageUrl(
        payload.exercise_enonce_image_relpath,
        cdnBase,
      ),
      exercise_corrige: buildImageUrl(
        payload.exercise_corrige_image_relpath,
        cdnBase,
      ),
      exam_full_enonce: buildImageUrl(
        payload.exam_full_enonce_relpath,
        cdnBase,
      ),
      exam_full_corrige: buildImageUrl(
        payload.exam_full_corrige_relpath,
        cdnBase,
      ),
    },
    score: typeof point.score === 'number' ? point.score : undefined,
  };
}

function formatRerankPassage(point: QdrantPoint): string {
  const q = readStringPayload(point, 'question_text') ?? '';
  const a = readStringPayload(point, 'answer_text') ?? '';
  return `Question: ${q}\nAnswer: ${a}`;
}

function readStringPayload(p: QdrantPoint, key: string): string | undefined {
  const v = (p.payload ?? {})[key];
  return typeof v === 'string' ? v : undefined;
}

function numberPayload(p: QdrantPoint, key: string): number | undefined {
  const v = (p.payload ?? {})[key];
  return typeof v === 'number' ? v : undefined;
}

/**
 * Distinct sorted list of exercise_number values across a list of
 * pairs — used to surface the exercise table-of-contents inside a
 * `list_exam_questions` response (the agent often wants to know "what
 * exercises are even in this exam?" before drilling further).
 */
function uniqueExerciseNumbers(points: QdrantPoint[]): number[] {
  const set = new Set<number>();
  for (const p of points) {
    const ex = numberPayload(p, 'exercise_number');
    if (typeof ex === 'number') set.add(ex);
  }
  return [...set].sort((a, b) => a - b);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/**
 * neo4j-driver returns integer columns as `{ low, high }` BigInt-ish
 * objects to avoid JS precision loss. None of our counts overflow 32 bits,
 * so this lossy cast is fine.
 */
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'object' && v !== null && 'low' in v) {
    const lowField = (v as { low: number }).low;
    return typeof lowField === 'number' ? lowField : null;
  }
  return null;
}
