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
import {
  VisionService,
  type FigureFocus,
  type VisionAnalysisResult,
} from '../vision.service';
import { FigurePerceptionCacheService } from '../figure-perception-cache.service';
import {
  buildExamCitation,
  buildExerciseCitation,
  buildFigureCitation,
  buildPairCitation,
  parsePairId,
  type Citation,
  type CitationContext,
} from '../citations';
import {
  formatReferenceDocForLLM,
  readReferenceDoc,
  referenceDocKindLabel,
} from './reference-doc';

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
2. Pure concept definitions with no specific problem to solve ("c'est quoi la mitose ?", "définis le mot dérivée"). For those, a normal prose explanation is the right shape.
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
 * Description for the emit_exam pedagogical tool. Forces the model to
 * emit a renderable exam paper (or a single exercise / short revision
 * set) as a structured payload — header banner, numbered exercises
 * with marks, recursively-nested questions, and per-leaf-question
 * corrigé — instead of authoring the paper as plain markdown prose.
 * The frontend renders the result as the *Exam Paper* surface: an
 * A4-aspect paper with the real Tunisian BAC banner, KaTeX math, and
 * per-question "Voir la correction" disclosures so the student can
 * self-check after working on paper.
 */
const EMIT_EXAM_TOOL_DESCRIPTION = `Use this tool to emit a renderable exam paper, single exercise, or short revision set as a structured payload. The frontend renders the output as a real Tunisian BAC-format paper — banner, numbered exercises with marks, recursively-nested questions, and a per-question "Voir la correction" disclosure the student opens to self-check after working on paper offline. Use this tool **every time** the student asks you to author exam-shaped content — never write the paper as plain markdown prose, that will render as a chat bubble instead of a paper.

## When to Use This Tool
1. The student asks for a mock paper / full sujet ("donne-moi un sujet BAC math 2024 style", "fais-moi un mock de 4h sur les complexes et la trigonométrie") → \`kind: "full_paper"\`.
2. The student asks for a single focused exercise ("donne-moi un exercice sur les suites", "construis-moi un exo difficile sur la dérivation", "un exo type BAC sur les complexes") → \`kind: "single_exercise"\`.
3. The student asks for a short revision set / drill ("fais-moi 3 exos rapides sur les limites", "quelques questions de révision sur l'arithmétique") → \`kind: "short_set"\`.

## When NOT to Use This Tool
1. The student asks for help on ONE specific question they're stuck on — that is \`emit_hint_ladder\`. The exam paper is for content the student will work on by themselves; the hint ladder is for content they're stuck on right now.
2. The student wants the full worked solution to a SINGLE question they already have in front of them — that is \`emit_solution_steps\`.
3. The student is asking for past-paper retrieval ("show me a 2022 controle question") — that is \`search_questions\` / \`get_question_pair\`.
4. The student is asking a pure concept / definition question.

## How to Structure the Payload
- **kind** — pick honestly. \`full_paper\` ONLY when the student asked for a full mock (3+ exercises, ~20 marks, with header). \`single_exercise\` when it's one exercise (even if it's long with sub-questions). \`short_set\` for a 2–3 exercise revision drill.
- **language** — match the student's language. Default \`fr\` for the Tunisian BAC corpus.
- **header** — populate only when \`kind === "full_paper"\`. \`matiere\` is the only required header field, but realistic mocks set \`year\`, \`session\`, \`section\`, \`duration_hours\`, \`coefficient\`, \`calculator_allowed\`. Skip the header object entirely for \`single_exercise\` / \`short_set\`.
- **exercises[].parts[]** — the recursive question tree. A part can either be a leaf (carries \`prompt_md\` + an optional \`correction\`) OR an inner node (carries its own \`prompt_md\` for the intro and a \`parts\` array of children — like 1) with sub-parts a) b) c) underneath). Mirror the real Tunisian BAC numbering: \`1.\`, \`1.a)\`, \`II.2.b)\`, etc. Use the \`label\` field for the visible numbering and the \`id\` for the machine identifier.
- **correction (per leaf part)** — fill it with the worked solution unless the student explicitly asked for "le sujet sans correction" / "paper only". \`solution_md\` is required when correction is present; \`marks_breakdown\`, \`remark_md\`, and \`common_mistake_md\` are optional pedagogical extras. **All-or-no rule**: if any leaf part carries a \`correction\`, every leaf part must — partial corrigés break the disclosure UI.
- **prompt_md / solution_md** — LaTeX-in-markdown. EVERY piece of mathematical notation MUST be wrapped in math delimiters: \`$...$\` for inline math, \`$$...$$\` for display math. Bare LaTeX without delimiters renders as raw source on the student's screen — the most common failure mode of this field.

## Important Notes
- Emit \`emit_exam\` exactly ONCE per turn. Never split a paper across multiple tool calls — the frontend can't reassemble the tree.
- **Self-contained prompts.** \`prompt_md\` must not reference "see the figure above" or "as in part 1)" without the figure / cross-reference being attached on the same part — the frontend renders parts independently and orphan refs will confuse the student.
- **Marks should sum.** \`sum(exercise.parts[].marks) === exercise.marks\` and \`sum(exercises[].marks) === footer.total_marks\` (default 20). The frontend tolerates a mismatch but will visually flag it; emit clean sums.
- **The paper IS the artefact.** Your prose must NOT restate the exercises or the corrigé in markdown after the tool call. A single short framing sentence before the tool call ("Voici un mock de 4h, format BAC math principale.") is fine; restating the questions or the answers in prose is the bug.
- Match the student's language in every field (FR by default; EN if the student writes in English).
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
- **latex** — the actual working line(s) for this step. EVERY piece of mathematical notation MUST be wrapped in math delimiters: \`$...$\` for inline math, \`$$...$$\` for display math. Bare LaTeX without delimiters (e.g. \`\\sqrt{4} = 2\` instead of \`$\\sqrt{4} = 2$\`) renders as raw source on the student's screen and is the single most common failure mode of this tool. ✅ Correct: \`$$|z_1| = \\sqrt{1^2 + (\\sqrt{3})^2} = \\sqrt{4} = 2$$\`. ❌ Wrong: \`|z_1| = \\sqrt{1^2 + (\\sqrt{3})^2} = 2\`. One step = one (or a few tightly-related) lines of working, not a whole sub-derivation.
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
 * Tool description for `show_question_assets`.
 *
 * Calls the figure-display surface for a v6 pair. The frontend
 * renders a tabbed panel — *Énoncé*, *Corrigé* (active-recall gated,
 * matching the corrigé-text gate on Stepwise Cards), *Exam complet*
 * — with click-to-zoom on each figure. The agent's job is to decide
 * *when* the student needs to look at the original page; the
 * panel handles every visual detail downstream.
 *
 * The intent is identical to the established `emit_*` pattern: the
 * agent decides when to invoke the dedicated UI surface instead of
 * inlining markdown images. We prefer this over autoplay-style
 * thumbnails on every search hit because (a) the chip's passive
 * thumbnails (rendered by `PastPaperChip`) already cover that case
 * and (b) inline `![alt](url)` images mid-prose look glued-on and
 * can't carry the recall gate.
 */
const SHOW_QUESTION_ASSETS_TOOL_DESCRIPTION = `Use this tool when the student wants to see the original énoncé / corrigé / exam page for a known Bac question pair, or when a figure (graph, schema, free-body diagram, table) is the proof you cannot replace with prose. The frontend renders a dedicated panel with tabs — *Énoncé* (always open), *Corrigé* (gated behind a "Reveal" button to keep the active-recall pattern), *Exam complet* — and click-to-zoom for each figure.

## When to Use This Tool
1. The student literally asks: "montre-moi l'énoncé / le corrigé / l'épreuve / la figure / le schéma", "show me the original", "open exercice 4", "ouvre la page", "je veux voir le sujet".
2. Your prose is referencing a figure that the OCR'd text cannot describe (a graph axis, a circuit schematic, a free-body sketch, a tableau de variations rendered as an image, a 3-D body for kinematics) — surface it as proof rather than describing the figure in words. **Note**: every search hit already carries \`figures.enonce[].caption\` / \`figures.corrige[].caption\` (LLM-generated French captions of each figure). Use those captions to *reason about* the figure without calling this tool; only call show_question_assets when the student needs to *see* the visual itself.
3. The student is reviewing a corrigé and the visual layout (alignment of equations, geometric figure used in the proof) carries information the LaTeX alone cannot.
4. The student is comparing exercise N énoncé to exercise N corrigé — pass \`side: "both"\` so both tabs are pre-loaded.

## When NOT to Use This Tool
1. The search-result \`PastPaperChip\` already renders an inline thumbnail strip for every entry in \`figures.enonce\`. If the student is just browsing search results, the chip thumbnails are enough — calling this tool on top is redundant.
2. The pair has \`figures.enonce.length === 0\` AND \`figures.corrige.length === 0\` AND no per-exercise stitched image — there is nothing to show, the panel would render an empty state, and the student would be confused.
3. The student's question is purely about concept / theory / vocabulary, OR the figure caption (in \`figures.*[].caption\`) already conveys everything the figure conveys. No need to render the visual.
4. You are about to author the worked solution — use \`emit_solution_steps\`. The card stack is the right surface for showing the steps; an image of the corrigé alongside it is overkill.

## How to Call
- \`pair_id\` — the canonical handle (e.g. \`"math-2017-controle-sciences-ex:ex_4:q_1.a"\`). Get it from \`search_questions\` / \`find_similar_questions\` / \`list_exam_questions\` / \`get_question_pair\`.
- \`side\` (optional) — which tab to open first:
  * \`"enonce"\` (default) — open the *Énoncé* tab; the corrigé is still reachable via the gate.
  * \`"corrige"\` — open the *Corrigé* tab pre-revealed (use sparingly: only when the student has explicitly asked for the corrigé). The active-recall gate still renders on the panel; pre-opening just defaults the tab to corrigé.
  * \`"both"\` — render the panel with two side-by-side cards (énoncé + corrigé, corrigé still gated). Use when the student is comparing the two.
  * \`"exam_full"\` — default to the full-exam view (énoncé page + corrigé page, scrollable). Use when the student asks to "see the whole exam page" or to read the surrounding question for context.

## Important Notes
- Do NOT inline \`![alt](url)\` markdown images in your prose. The panel is the canonical surface. Inline images break the layout and skip the recall gate.
- Do NOT call this on every search match. \`PastPaperChip\` already shows a thumbnail strip for figured pairs.
- The panel reads the per-figure arrays \`figures.enonce\` / \`figures.corrige\` from the pair payload (the canonical source of truth) and renders gracefully when one side has no figure (the tab is hidden, not greyed-out).
- Match the student's language in any framing prose around the panel. The panel labels are FR by default.
`;

const INSPECT_FIGURE_TOOL_DESCRIPTION = `Use this tool when **you** (the agent) need to actually *see* a figure — not when the student wants to see it (that's \`show_question_assets\`). The result is a structured perception payload (free-form analysis, axes, values, topology, OCR'd text, count, confidence) you can reason over privately before answering. Captions ship in every search hit and cover most cases; \`inspect_figure\` is the **escape hatch** for when the caption doesn't.

## When to Use This Tool
1. The student asks you to *read* something off a figure that the caption doesn't state explicitly — "que vaut u(t=2) ?", "combien de forces sont dessinées ?", "le condensateur est en série ou en parallèle ?", "quelle est l'asymptote sur le graphe ?", "combien de chromosomes sur ce caryotype ?", "quelle bande apparaît à 5 kb sur l'électrophorégramme ?".
2. Your answer hinges on a specific visual detail (axis range, branch topology, vector direction, the *value* of an embedded number, an OCR'd legend label, a chromosome count, an arbre généalogique edge) that the caption does not state explicitly.
3. Your hypothesis from the énoncé text disagrees with what the caption says — call \`inspect_figure\` to break the tie before answering. Do NOT silently pick one side.
4. You are about to commit to a numeric answer that depends on reading a value from a figure. Verify before you assert.

## When NOT to Use This Tool (HARD CONSTRAINT)
1. **The pair has no visual content.** If \`has_figure_enonce\` and \`has_figure_corrige\` are both false **and** no \`images.exercise_enonce\` / \`images.exam_full_enonce\` URL ships in the search-result payload, there is nothing to inspect. The tool will return \`no_visual_content\` and you should stop calling it for that pair.
2. **You want to read the *énoncé text*.** The énoncé is already OCR'd into \`question_text\` on every search / get_question_pair hit. Do NOT call \`inspect_figure\` to OCR the prose, count exercises on the page, or check "is there an Exercise 4?" — use \`list_exam_questions\` / \`count_questions\` / the énoncé text instead.
3. **The caption already answers the question.** Reading \`figures.{enonce,corrige}[].caption\` is free; calling this tool is not.
4. **The turn is purely conceptual / vocabulary / theory** — no figure-grounded claim. The vision pass adds latency for no benefit.
5. **You already inspected this figure in this turn.** Same figure + same focus + same question is cached; a re-call is fast, but you should not need to. Re-call only with a *different* focus if the first pass missed.
6. **You don't have a specific question about the figure.** Grounding the call in a concrete question dramatically improves the perception. Generic "look at the page" calls produce generic noise.
7. **The student wants to *see* the figure themselves** — call \`show_question_assets\` instead.

## How to Call
- \`pair_id\` — the canonical pair handle from \`search_questions\` / \`get_question_pair\` etc.
- \`side\` — one of:
  * \`"enonce"\` / \`"corrige"\` — inspect the per-figure crops on the énoncé / corrigé side. **Only valid when \`figures.<side>[].length > 0\` for the pair.** This is the default path.
  * \`"exercise_enonce"\` / \`"exercise_corrige"\` — inspect the full stitched per-exercise scan (\`images.exercise_enonce\` / \`images.exercise_corrige\`). Use when the pair has no per-figure crops but ships a whole-exercise image (typical of info / éco exams).
  * \`"exam_full_enonce"\` / \`"exam_full_corrige"\` — inspect the whole-exam scan (\`images.exam_full_*\`). Reserve this for last-resort lookups when neither per-figure nor per-exercise crops exist.
  The corrigé sides are fair game when the student is past the active-recall gate.
- \`figure\` — either a label like \`"figure 1"\` (the labels match \`figures.*[].label\` in search-result payloads) or \`"all"\` to inspect every figure on the side. Defaults to \`"all"\` — pick a single label whenever you can to save tokens. **Ignored** on \`exercise_*\` / \`exam_full_*\` sides (one image per side).
- \`focus\` (optional) — steers the structured fields the model populates:
  * \`"general"\` (default) — short overall description; populates \`axes\` if the figure is a graph.
  * \`"axes"\` — read axes labels + ranges precisely.
  * \`"values"\` — read notable (x, y) readings off the curve.
  * \`"topology"\` — classify the circuit / mechanical setup / ER cardinality.
  * \`"text"\` — OCR the in-figure annotations.
  * \`"count"\` — count the requested elements (vectors, capacitors, peaks…).
- \`question\` (optional, **strongly recommended**) — the natural-language question you want answered. Grounding the call in your concrete question dramatically improves the perception. Examples: "Le circuit est-il série ou parallèle ?", "Quelle est la valeur de u(t) à t=2s ?", "Combien de vecteurs forces sont dessinés ?".

## Output
The tool returns one entry per figure inspected:

\`\`\`
{
  "figures": [
    {
      "label": "figure 1",
      "url": "https://pub-...r2.dev/...",
      "caption_short": "<first 240 chars of the existing French caption>",
      "perception": {
        "analysis": "<1–4 phrases en français>",
        "axes": null | { x, y, x_range, y_range },
        "values": null | [{ x, y }],
        "topology": null | "RC_series" | …,
        "text_ocr": null | ["…"],
        "count": null | <int>,
        "confidence": 0..1
      },
      "cache_hit": <bool>
    }
  ],
  "model": "<model id>",
  "inspected_count": <int>,
  "cached_count": <int>
}
\`\`\`

Read \`perception.confidence\` before quoting a numeric value verbatim. If \`confidence < 0.5\` and the answer matters, hedge ("d'après la lecture du graphe, environ …") rather than asserting.

## Important Notes
- The vision pass adds ~1–3 s of latency. Worth it for a verified answer; not worth it for a conceptual turn.
- Results are cached by \`(relpath, focus, question)\` — repeating the same call is essentially free.
- Per-thread soft budget: ~5 inspections / minute. Beyond that, you'll get a \`limit_reached\` envelope back; either rely on captions or wait for the budget window to roll.
- Do NOT mention the existence of this tool to the student; just answer the question. The frontend may surface a "🔍 figure inspected" pill on its own.
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
 * The v6 omni ingest applies the grade + quarantine gates upstream
 * of indexing (only graded-correct, non-quarantined pairs land in
 * Qdrant), so the agent surface no longer re-enforces them at query
 * time. See {@link MANDATORY_FILTER} for the historical context.
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
  /**
   * Sample-cap for `count_questions`: how many matching pairs to scroll
   * AFTER the count round-trip so the agent gets immediate citation
   * fodder ("here are 3 representative questions") without firing a
   * separate `search_questions` call. Kept small so the
   * count-then-sample path stays cheaper than search end-to-end.
   */
  private static readonly COUNT_QUESTIONS_SAMPLE_CAP = 5;

  /**
   * Soft per-thread budget for `inspect_figure`. We track a sliding
   * window of timestamps per thread; when more than {@link INSPECT_FIGURE_BUDGET_MAX}
   * calls land inside {@link INSPECT_FIGURE_BUDGET_WINDOW_MS} we return
   * a `limit_reached` envelope instead of calling the vision API.
   *
   * The map is bounded by `INSPECT_FIGURE_BUDGET_MAX_THREADS`; cold threads
   * are evicted lazily on miss to keep the footprint small.
   */
  private static readonly INSPECT_FIGURE_BUDGET_MAX = 5;
  private static readonly INSPECT_FIGURE_BUDGET_WINDOW_MS = 60_000;
  private static readonly INSPECT_FIGURE_BUDGET_MAX_THREADS = 1024;
  private readonly inspectFigureCalls = new Map<string, number[]>();

  constructor(
    private readonly qdrant: QdrantClientProvider,
    private readonly neo4j: Neo4jClientProvider,
    private readonly embeddings: EmbeddingsClient,
    private readonly reranker: RerankerClient,
    private readonly vision: VisionService,
    private readonly perceptionCache: FigurePerceptionCacheService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Public CDN base URL for v6 image relpaths. Set as `R2_PUBLIC_BASE`
   * (the v6 ingest stores relpaths against a Cloudflare R2 public
   * bucket; the convention is to namespace the bucket under
   * `…r2.dev/ocr_omni`). Either the canonical form
   * `…r2.dev/ocr_omni` or the bare bucket origin `…r2.dev` is
   * accepted — `buildImageUrl` ensures the final URL contains exactly
   * one `ocr_omni/` segment regardless of how the env is shaped. When
   * unset, image URL fields fall back to raw relpath strings so the
   * frontend can either compose its own URL or render a "no asset"
   * placeholder without crashing.
   */
  private get imageCdnBase(): string | undefined {
    return this.config.get<string>('R2_PUBLIC_BASE');
  }

  getAll(): StructuredToolInterface[] {
    return [
      this.searchQuestionsTool(),
      this.getQuestionPairTool(),
      this.showQuestionAssetsTool(),
      this.inspectFigureTool(),
      this.findSimilarQuestionsTool(),
      this.countQuestionsTool(),
      this.listChaptersTool(),
      this.listTopicsTool(),
      this.listExamsTool(),
      this.listSectionsTool(),
      this.listExamQuestionsTool(),
      this.emitHintLadderTool(),
      this.emitSolutionStepsTool(),
      this.emitExamTool(),
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
                  'The complete worked solution. EVERY piece of ' +
                    'mathematical notation MUST be wrapped in math ' +
                    'delimiters — `$...$` for inline math, `$$...$$` ' +
                    'for display math. Bare LaTeX (e.g. `\\sqrt{4}` ' +
                    'instead of `$\\sqrt{4}$`) renders as raw source ' +
                    "on the student's screen. Use numbered steps when " +
                    'helpful. The frontend de-emphasises this rung ' +
                    'visually so the student is nudged to try the ' +
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
                    'The actual working line(s) for this step. EVERY ' +
                      'piece of mathematical notation MUST be wrapped ' +
                      'in math delimiters — `$...$` for inline math ' +
                      'and `$$...$$` for display math. Bare LaTeX ' +
                      'without delimiters (e.g. `\\sqrt{4} = 2` instead ' +
                      'of `$\\sqrt{4} = 2$`) renders as raw source on ' +
                      "the student's screen and is the most common " +
                      'failure mode of this field. ' +
                      'Example (correct): "$$|z_1| = \\sqrt{1^2 + ' +
                      '(\\sqrt{3})^2} = \\sqrt{4} = 2$$". ' +
                      'Example (wrong, do not do this): "|z_1| = ' +
                      '\\sqrt{1^2 + (\\sqrt{3})^2} = 2". ' +
                      'One step = one (or a few tightly-related) ' +
                      'lines of working, not a whole sub-derivation.',
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

  // ---- emit_exam --------------------------------------------------------

  /**
   * *Exam Paper* surface. Forces the model to emit exam-shaped
   * content as a structured tree — header banner, numbered
   * exercises with marks, recursively-nested questions, and an
   * optional per-leaf-question corrigé — instead of authoring the
   * paper as plain markdown prose. The frontend renders the result
   * as an A4-aspect Tunisian BAC paper with KaTeX math and per-
   * question "Voir la correction" disclosures, plus print modes
   * (sujet seul / sujet + corrigé / corrigé seul) so the student
   * can hit *Imprimer* and work the paper offline before peeking.
   *
   * Like {@link writeTodosTool}, {@link emitHintLadderTool} and
   * {@link emitSolutionStepsTool}, this is a no-op on the server.
   * The authoritative state lives on the wire as the
   * `tool-emit_exam` part input — the frontend reads
   * `part.input.exercises`, `part.input.header`, etc. directly off
   * the message stream. The server-side function just echoes a
   * count back to keep the agent loop happy.
   */
  private emitExamTool(): StructuredToolInterface {
    // Recursive part schema — a part can be a leaf (carries
    // `prompt_md` + an optional `correction`) OR an inner node
    // (carries `prompt_md` as an intro plus a `parts` array of
    // children). `z.lazy()` is the canonical way to express a
    // recursive Zod schema; the explicit `z.ZodTypeAny` annotation
    // is needed because TypeScript can't infer a recursive type
    // through the lazy closure on its own.
    const PartSchema: z.ZodTypeAny = z.lazy(() =>
      z.object({
        id: z
          .string()
          .min(1)
          .describe(
            'Stable machine identifier for this part. Used by the ' +
              'frontend as a React key and (in future versions) by ' +
              'the grading layer. Example: "ex1_q2_b".',
          ),
        label: z
          .string()
          .min(1)
          .describe(
            'Visible BAC-style numbering as shown on the paper. ' +
              'Examples: "1.", "1.a)", "II.2.b)". Mirror real ' +
              'Tunisian BAC papers — the numbering carries the ' +
              'nesting visually.',
          ),
        marks: z
          .number()
          .optional()
          .describe(
            'Marks awarded to this leaf part, e.g. 1.5 or 0.5. ' +
              'Only set on leaf parts. Inner nodes inherit the sum ' +
              'of their children. The frontend renders these on ' +
              'the right margin like real BAC papers.',
          ),
        prompt_md: z
          .string()
          .min(1)
          .describe(
            'The question statement / sub-question prompt as ' +
              'LaTeX-in-markdown. EVERY piece of mathematical ' +
              'notation MUST be wrapped in math delimiters — ' +
              '`$...$` for inline math and `$$...$$` for display ' +
              'math. Self-contained — no "see the figure above" ' +
              'unless the figure is attached on this same part.',
          ),
        expected_answer_format: z
          .enum([
            'numeric',
            'short_text',
            'long_text',
            'mcq',
            'proof',
            'symbolic',
            'figure',
            'none',
          ])
          .optional()
          .describe(
            'Optional. Forward-compatibility hint for v2 grading — ' +
              "what shape the student's answer is expected to take. " +
              'Unused by v1 rendering. Set "none" on inner nodes.',
          ),
        parts: z
          .array(PartSchema)
          .optional()
          .describe(
            'Optional. Child sub-parts for inner nodes (a question ' +
              'with sub-questions a), b), c) underneath). Leaf ' +
              'parts omit this field. Recursion depth is ' +
              'intentionally unbounded — match the depth of the ' +
              'real paper.',
          ),
        correction: z
          .object({
            solution_md: z
              .string()
              .min(1)
              .describe(
                'The full worked solution for this leaf part. ' +
                  'LaTeX-in-markdown, with all math wrapped in ' +
                  'delimiters. This is what the student sees when ' +
                  'they tap "Voir la correction".',
              ),
            marks_breakdown: z
              .array(
                z.object({
                  marks: z
                    .number()
                    .describe(
                      'Points awarded by this rubric line ' +
                        '(e.g. 0.25, 0.5, 1).',
                    ),
                  reason: z
                    .string()
                    .min(1)
                    .describe(
                      'What the student must produce to earn ' +
                        "these points (Tunisian BAC corrector's " +
                        'shorthand). Example: "Mise en équation."',
                    ),
                }),
              )
              .optional()
              .describe(
                'Optional. Tunisian-style barème breakdown — short ' +
                  '"0.25 pour la mise en équation, 0.5 pour la ' +
                  'résolution, 0.25 pour la vérification" lines.',
              ),
            remark_md: z
              .string()
              .optional()
              .describe(
                'Optional pedagogical aside — a one or two sentence ' +
                  'remark about why this question matters, the ' +
                  'theorem in play, the technique to remember. ' +
                  'Renders as a soft callout under the solution.',
              ),
            common_mistake_md: z
              .string()
              .optional()
              .describe(
                'Optional. The typical Tunisian-BAC trap on this ' +
                  'question. Renders as a "⚠ Erreur classique" ' +
                  'callout. Skip when the question has no notable ' +
                  'trap — do not pad.',
              ),
          })
          .optional()
          .describe(
            'Optional worked correction for this leaf part. Skip ' +
              'when the student explicitly asked for the paper ' +
              'without corrigé. ALL-OR-NO rule: if any leaf carries ' +
              'a correction, every leaf must — partial corrigés ' +
              'break the disclosure UI.',
          ),
      }),
    );

    return tool(
      async ({ exercises }) => {
        const exerciseCount = Array.isArray(exercises) ? exercises.length : 0;
        let leafCount = 0;
        let leavesWithCorrection = 0;
        const walk = (parts: unknown): void => {
          if (!Array.isArray(parts)) return;
          for (const p of parts) {
            if (!p || typeof p !== 'object') continue;
            const part = p as {
              parts?: unknown;
              correction?: unknown;
            };
            const children = part.parts;
            if (Array.isArray(children) && children.length > 0) {
              walk(children);
            } else {
              leafCount += 1;
              if (part.correction && typeof part.correction === 'object') {
                leavesWithCorrection += 1;
              }
            }
          }
        };
        if (Array.isArray(exercises)) {
          for (const ex of exercises) {
            if (ex && typeof ex === 'object') {
              walk((ex as { parts?: unknown }).parts);
            }
          }
        }
        return JSON.stringify({
          ok: true,
          exercise_count: exerciseCount,
          leaf_count: leafCount,
          leaves_with_correction: leavesWithCorrection,
        });
      },
      {
        name: 'emit_exam',
        description: EMIT_EXAM_TOOL_DESCRIPTION,
        schema: z.object({
          kind: z
            .enum(['full_paper', 'single_exercise', 'short_set'])
            .describe(
              'Discriminator for layout. `full_paper` for a 3+ ' +
                'exercise mock with the BAC banner. `single_exercise` ' +
                'for one focused exercise (no banner). `short_set` ' +
                'for a 2-3 exercise revision drill (no banner).',
            ),
          language: z
            .enum(['fr', 'en', 'ar'])
            .optional()
            .describe(
              'Language of every prose / LaTeX field. Match the ' +
                'student. Default `fr` for the Tunisian BAC corpus.',
            ),
          header: z
            .object({
              matiere: z
                .string()
                .optional()
                .describe(
                  'Subject as it would appear on a real Tunisian ' +
                    'BAC paper. Examples: "Mathématiques", "Sciences ' +
                    'Physiques", "Sciences de la Vie et de la Terre".',
                ),
              year: z
                .number()
                .int()
                .optional()
                .describe(
                  'Year shown on the banner. Use the current ' +
                    'academic year if the student did not specify.',
                ),
              session: z
                .enum(['principale', 'controle', 'rattrapage'])
                .optional()
                .describe(
                  'BAC session (principale = June, controle = July ' +
                    'retake, rattrapage = orientation re-sit).',
                ),
              section: z
                .string()
                .optional()
                .describe(
                  'Section / track. Examples: "Mathématiques", ' +
                    '"Sciences Expérimentales", "Sciences Techniques", ' +
                    '"Économie et Gestion", "Lettres".',
                ),
              duration_hours: z
                .number()
                .optional()
                .describe(
                  'Duration of the paper in hours (e.g. 3, 3.5, 4). ' +
                    'Renders as "Durée : 4h" on the banner.',
                ),
              coefficient: z
                .number()
                .optional()
                .describe(
                  'BAC coefficient for this matière in the ' +
                    "student's section (e.g. 4 for math in " +
                    'Mathématiques, 2 for math in Lettres).',
                ),
              calculator_allowed: z
                .boolean()
                .optional()
                .describe(
                  'Whether non-programmable calculators are ' +
                    'allowed. Default behaviour matches real BAC ' +
                    'papers (almost always true for STEM matières).',
                ),
              notes_md: z
                .string()
                .optional()
                .describe(
                  'Optional free-text notes shown below the banner ' +
                    '("Le sujet comporte X pages.", citations of ' +
                    'past papers using `lemma:exam:...` URIs, etc.).',
                ),
            })
            .optional()
            .describe(
              'Banner metadata. Populate when `kind === ' +
                '"full_paper"`; skip the whole object for ' +
                '`single_exercise` / `short_set`.',
            ),
          exercises: z
            .array(
              z.object({
                id: z
                  .string()
                  .min(1)
                  .describe(
                    'Stable machine identifier for this exercise. ' +
                      'Example: "ex1".',
                  ),
                label: z
                  .string()
                  .min(1)
                  .describe(
                    'Visible heading. Example: "Exercice 1" or ' +
                      '"Exercice I". Numbering matches the visible ' +
                      'numbering on the paper.',
                  ),
                title: z
                  .string()
                  .optional()
                  .describe(
                    'Optional short topic title for the exercise. ' +
                      'Example: "Nombres complexes" or "Suites ' +
                      'récurrentes". Renders next to the label.',
                  ),
                marks: z
                  .number()
                  .optional()
                  .describe(
                    'Total marks for this exercise. Should equal ' +
                      'the sum of its leaf parts. Renders on the ' +
                      'right margin next to the label.',
                  ),
                intro_md: z
                  .string()
                  .optional()
                  .describe(
                    'Optional intro paragraph for the exercise — ' +
                      'context that applies to every sub-question ' +
                      '("Le plan est rapporté à un repère ' +
                      'orthonormé..."). LaTeX-in-markdown.',
                  ),
                parts: z
                  .array(PartSchema)
                  .min(1)
                  .describe(
                    'Ordered list of questions for this exercise. ' +
                      'Each part can recurse with its own `parts` ' +
                      'array to match BAC-style sub-question nesting.',
                  ),
              }),
            )
            .min(1)
            .describe(
              'Ordered list of exercises. For `full_paper`, expect ' +
                '3+ exercises totalling ~20 marks. For ' +
                '`single_exercise`, exactly one. For `short_set`, ' +
                '2-3.',
            ),
          footer: z
            .object({
              total_marks: z
                .number()
                .optional()
                .describe(
                  'Total marks for the paper (default 20 for the ' +
                    'Tunisian BAC). Should equal sum of ' +
                    'exercises[].marks.',
                ),
              closing_note_md: z
                .string()
                .optional()
                .describe(
                  'Optional closing note ("Bon courage !", ' +
                    '"Bonne réflexion."). Renders after the last ' +
                    'exercise.',
                ),
            })
            .optional()
            .describe(
              'Optional footer block. Skip entirely for ' +
                '`single_exercise` / `short_set`.',
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

          // We need a few extra reranked passages so the post-filter
          // (figures_required) doesn't starve the response. The cap
          // is bounded by the recall fan-out anyway.
          const rerankTopK =
            args.figures_required && args.figures_required !== 'any'
              ? Math.min(
                  AgentToolsService.RECALL_FANOUT,
                  Math.max(limit * 3, limit),
                )
              : limit;
          const reranked = await this.reranker.rerank({
            query: args.query,
            passages: candidates,
            getText: (p) => formatRerankPassage(p),
            topK: rerankTopK,
          });

          const filtered = applyFiguresRequiredFilter(
            reranked,
            args.figures_required,
          ).slice(0, limit);

          const cdnBase = this.imageCdnBase;
          return JSON.stringify({
            results: filtered.map((p) => formatPairForLLM(p, { cdnBase })),
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
          'Returns past exam questions matching the query — the ingest ' +
          'pipeline only admits graded-correct, non-quarantined pairs so ' +
          'every hit is safe to surface as a reference. ' +
          'Each result carries `figures.enonce[]` and `figures.corrige[]` ' +
          'arrays of `{label, caption, url}` — the captions are ' +
          'LLM-generated French descriptions of each figure, useful to ' +
          'reason about visual content without calling show_question_assets.',
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
              'Specific exam handle. Canonical form is the hyphenated, ' +
                'matiere-prefixed `exam_id` from list_exams (e.g. ' +
                '"math-2017-controle-sciences-ex"). The legacy v1 ' +
                'underscored form ("2017_controle_informatique_math") ' +
                'is also accepted for backwards compatibility.',
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
              'If true, only return questions whose author tagged them as ' +
                '"requires a figure to solve". This filters on the upstream ' +
                '`requires_figure` payload flag (whether the question is ' +
                'unsolvable without seeing a figure), NOT on whether figures ' +
                'happen to exist in our corpus. To filter by actual figure ' +
                'availability, use `figures_required` instead.',
            ),
          figures_required: z
            .enum(['enonce', 'corrige', 'either', 'none', 'any'])
            .optional()
            .describe(
              'Filter results by per-figure ARRAY availability (the ' +
                'canonical source of truth for figures, computed from ' +
                '`figures.enonce` / `figures.corrige` array length). Values: ' +
                '`enonce` requires ≥1 énoncé figure; `corrige` requires ≥1 ' +
                'corrigé figure; `either` requires ≥1 figure on either side; ' +
                '`none` requires zero figures on both sides (useful when the ' +
                'student wants a text-only practice problem); `any` (default) ' +
                'applies no figure filter. Prefer this over `requires_figure` ' +
                'when the student asks "montre-moi un exo avec un schéma" / ' +
                '"je veux un exercice avec une figure".',
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

  // ---- show_question_assets --------------------------------------------

  /**
   * Surface the four v6 image relpaths for a known pair (énoncé +
   * corrigé exercise figures, plus the full-exam énoncé/corrigé
   * pages) as fully-qualified asset URLs. The agent decides *when*;
   * the frontend `<QuestionAssetsBlock>` decides *how* (tabs, recall
   * gate on the corrigé side, click-to-zoom). We deliberately keep
   * the response minimal — just enough metadata for the panel
   * header (matière / year / session / exercise) and the four URLs
   * — so the LLM doesn't accidentally repeat the question text in
   * prose alongside the panel.
   *
   * Grade + quarantine gating is applied upstream of the v6 ingest,
   * so only graded-correct, non-quarantined pairs are reachable here
   * even if the agent fabricates a pair_id that points at one.
   */
  private showQuestionAssetsTool(): StructuredToolInterface {
    return tool(
      async ({ pair_id, side }) => {
        try {
          const point = await this.qdrant.getByPairId(pair_id);
          if (!point) {
            return `No question pair found for pair_id="${pair_id}".`;
          }
          const payload = (point.payload ?? {}) as Record<string, unknown>;
          const cdnBase = this.imageCdnBase;
          const resolvedPairId = (payload.pair_id_logical ??
            payload.pair_id ??
            pair_id) as string;
          const pairContext: CitationContext = {
            pair_id: resolvedPairId,
            matiere: payload.matiere as string | null | undefined,
            year: (payload.year ?? payload.exam_year) as
              | number
              | string
              | null
              | undefined,
            session: payload.session as string | null | undefined,
            track: (payload.track ?? payload.filiere) as
              | string
              | null
              | undefined,
            exercise_number: payload.exercise_number as
              | number
              | string
              | null
              | undefined,
            question_number: payload.question_number as
              | string
              | null
              | undefined,
          };
          const images = {
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
          };
          // Always read per-figure arrays as the source of truth
          // — the legacy `has_figure_*` booleans went stale on the
          // inverse side after the May 9 figures injection (~600
          // pairs have populated arrays but `has_figure_*=false`).
          const figures = formatFiguresForLLM(payload, cdnBase, {
            full: true,
            pairContext,
          });
          // Surface the per-exam *reference document* (dossier
          // technique on technique exams, dossier comptable on
          // gestion exams, etc.) when the v6.6 ingest emitted one.
          // The full text + figures + page PNGs come back here so
          // the frontend `<QuestionAssetsBlock>` can render the
          // "Dossier" tab without an extra round-trip to the
          // references resolver.
          const referenceDocRaw = readReferenceDoc(payload);
          const referenceDoc = referenceDocRaw
            ? formatReferenceDocForLLM(referenceDocRaw, {
                cdnBase,
                examHandle:
                  typeof payload.exam_id === 'string' &&
                  payload.exam_id.length > 0
                    ? payload.exam_id
                    : null,
              })
            : null;
          const hasAnyFigure =
            figures.enonce.length > 0 ||
            figures.corrige.length > 0 ||
            images.exercise_enonce !== null ||
            images.exercise_corrige !== null ||
            (referenceDoc?.n_pages ?? 0) > 0;
          return JSON.stringify({
            pair_id: resolvedPairId,
            citation: buildPairCitation(pairContext),
            exercise_citation: buildExerciseCitation(pairContext),
            exam_citation: buildExamCitation({
              exam_handle: (payload.exam_id ?? null) as string | null,
              matiere: pairContext.matiere,
              year: pairContext.year,
              session: pairContext.session,
              track: pairContext.track,
            }),
            exam: payload.exam ?? null,
            exam_id: payload.exam_id ?? null,
            year: payload.year ?? payload.exam_year ?? null,
            session: payload.session ?? null,
            matiere: payload.matiere ?? null,
            track: payload.track ?? payload.filiere ?? null,
            exercise_number: payload.exercise_number ?? null,
            question_number: payload.question_number ?? null,
            chapter: payload.chapter ?? null,
            has_figure_enonce: figures.enonce.length > 0,
            has_figure_corrige: figures.corrige.length > 0,
            n_enonce_figures: figures.enonce.length,
            n_corrige_figures: figures.corrige.length,
            source_pages_enonce: payload.source_pages_enonce ?? [],
            source_pages_corrige: payload.source_pages_corrige ?? [],
            has_any_figure: hasAnyFigure,
            default_side: side ?? 'enonce',
            reference_doc: referenceDoc,
            images,
            figures,
          });
        } catch (err) {
          this.logger.warn(`show_question_assets failed: ${String(err)}`);
          return `Error loading question assets: ${(err as Error).message}`;
        }
      },
      {
        name: 'show_question_assets',
        description: SHOW_QUESTION_ASSETS_TOOL_DESCRIPTION,
        schema: z.object({
          pair_id: z
            .string()
            .describe(
              'The pair_id (canonical handle) — e.g. ' +
                '"math-2017-controle-sciences-ex:ex_4:q_1.a". Get it from ' +
                'search_questions / find_similar_questions / list_exam_questions / ' +
                'get_question_pair output.',
            ),
          side: z
            .enum(['enonce', 'corrige', 'both', 'exam_full', 'dossier'])
            .optional()
            .describe(
              'Which tab the panel opens to first. Default "enonce". ' +
                '"corrige" pre-opens the corrigé tab (the active-recall reveal ' +
                'gate still renders). "both" places énoncé + corrigé side-by-side. ' +
                '"exam_full" defaults to the full-exam page view. ' +
                '"dossier" opens the per-exam reference document (dossier ' +
                'technique on technique exams, dossier comptable on gestion ' +
                'exams, etc.) — only useful when the pair has has_reference_doc=true.',
            ),
        }),
      },
    );
  }

  // ---- inspect_figure --------------------------------------------------

  /**
   * Vision escape hatch — let the agent *see* a figure when the
   * existing French caption isn't specific enough.
   *
   * Why this exists:
   *   Every search hit ships an LLM-generated French caption per
   *   figure (~240 chars in search results, full text in
   *   `show_question_assets`). Captions are great for breadth ("this
   *   exercise is about a circuit RC") but lossy for specifics ("the
   *   value of u(t) at t=2 s is ≈3.7 V"). When the answer hinges on
   *   a specific visual reading, the agent calls `inspect_figure`
   *   and gets a structured perception payload back from a vision
   *   LLM (NIM-hosted Llama 3.2 90B Vision by default).
   *
   * Cost discipline:
   *   - Postgres-backed cache keyed on `(relpath, focus, normalised_question)`
   *     so repeated calls cost ~0. The popular figures get inspected
   *     once corpus-wide and the entire org benefits.
   *   - Soft per-thread sliding-window budget
   *     ({@link AgentToolsService.INSPECT_FIGURE_BUDGET_MAX} calls per
   *     {@link AgentToolsService.INSPECT_FIGURE_BUDGET_WINDOW_MS} ms) — the
   *     system prompt tells the agent to call sparingly; this is the
   *     belt to the prompt's suspenders.
   *
   * Failure mode:
   *   If the vision call fails (HTTP error, timeout, missing API key)
   *   the response still has the right shape; the per-figure
   *   `perception` carries `confidence=0` and an explanatory
   *   `analysis` string. The agent can fall back to the caption
   *   without crashing the turn.
   */
  private inspectFigureTool(): StructuredToolInterface {
    return tool(
      async (
        { pair_id, side, figure, focus, question },
        runConfig?: { configurable?: { thread_id?: string } },
      ) => {
        const requestedFocus: FigureFocus = focus ?? 'general';
        const figureSelector = (figure ?? 'all').trim();

        try {
          const point = await this.qdrant.getByPairId(pair_id);
          if (!point) {
            return JSON.stringify({
              error: `No question pair found for pair_id="${pair_id}".`,
              figures: [],
              inspected_count: 0,
              cached_count: 0,
            });
          }

          const cdnBase = this.imageCdnBase;
          const inspectPayload = (point.payload ?? {}) as Record<
            string,
            unknown
          >;
          const inspectPairId = (inspectPayload.pair_id_logical ??
            inspectPayload.pair_id ??
            pair_id) as string;
          const inspectPairContext: CitationContext = {
            pair_id: inspectPairId,
            matiere: inspectPayload.matiere as string | null | undefined,
            year: (inspectPayload.year ?? inspectPayload.exam_year) as
              | number
              | string
              | null
              | undefined,
            session: inspectPayload.session as string | null | undefined,
            track: (inspectPayload.track ?? inspectPayload.filiere) as
              | string
              | null
              | undefined,
            exercise_number: inspectPayload.exercise_number as
              | number
              | string
              | null
              | undefined,
            question_number: inspectPayload.question_number as
              | string
              | null
              | undefined,
          };
          // Reuse `formatFiguresForLLM` to get the canonical
          // (label, caption, url, citation) shape — keeps caption
          // truncation aligned with what the agent sees in search
          // results, and gives every inspected figure the
          // `lemma:fig:…` handle the agent should drop into prose
          // alongside the perceived value.
          const allFigures = formatFiguresForLLM(point.payload, cdnBase, {
            full: false,
            pairContext: inspectPairContext,
          });

          // Whole-page sides (`exercise_*` / `exam_full_*`) operate on
          // the stitched scan stored at `*_image_relpath`, not on the
          // per-figure crops. Synthesise a single "figure" entry from
          // the payload so the rest of the pipeline (budget, cache,
          // perception, response shape) is identical.
          const wholePage = buildWholePageFigure(inspectPayload, side, cdnBase);
          const isWholePageSide = side !== 'enonce' && side !== 'corrige';
          const sideFigures: FormattedFigure[] = isWholePageSide
            ? wholePage
              ? [wholePage]
              : []
            : allFigures[side as 'enonce' | 'corrige'];

          if (sideFigures.length === 0) {
            return JSON.stringify(
              buildNoFiguresOnSideError({
                pair_id: inspectPairId,
                side,
                payload: inspectPayload,
                cdnBase,
                allFigures,
              }),
            );
          }

          const targets = isWholePageSide
            ? sideFigures
            : filterFiguresBySelector(sideFigures, figureSelector);
          if (targets.length === 0) {
            return JSON.stringify({
              error:
                `figure="${figureSelector}" not found on side="${side}". ` +
                `Available labels: ${sideFigures
                  .map((f) => f.label)
                  .join(', ')}.`,
              figures: [],
              inspected_count: 0,
              cached_count: 0,
            });
          }

          const threadId = runConfig?.configurable?.thread_id ?? 'unknown';
          const remaining = this.checkInspectFigureBudget(threadId);
          if (remaining <= 0) {
            return JSON.stringify({
              error: 'limit_reached',
              note:
                'Soft per-thread inspect_figure budget exhausted ' +
                `(max ${AgentToolsService.INSPECT_FIGURE_BUDGET_MAX} per ` +
                `${AgentToolsService.INSPECT_FIGURE_BUDGET_WINDOW_MS / 1000}s). ` +
                'Fall back to figures.*[].caption for this turn or wait for the window to roll.',
              figures: [],
              inspected_count: 0,
              cached_count: 0,
            });
          }

          // We honour `remaining` calls, even if the agent asked for
          // more figures. The remainder are returned with
          // `perception=null` + `truncated=true` so the agent knows
          // it didn't get a full pass.
          const toInspect = targets.slice(0, remaining);
          const skipped = targets.slice(remaining);

          const inspected: InspectFigureEntry[] = [];
          let cachedCount = 0;
          let model = '';

          for (const fig of toInspect) {
            const relpath = isWholePageSide
              ? readWholePageRelpath(inspectPayload, side)
              : readRelpathForLabel(
                  point.payload,
                  side as 'enonce' | 'corrige',
                  fig.label,
                );
            const result = await this.runInspectFigure({
              threadId,
              relpath,
              url: fig.url,
              caption: fig.caption,
              focus: requestedFocus,
              question,
            });
            if (result.cacheHit) cachedCount += 1;
            if (result.model && !model) model = result.model;
            inspected.push({
              label: fig.label,
              url: fig.url,
              caption_short: fig.caption,
              citation: fig.citation,
              perception: result.analysis.analysis ? result.analysis : null,
              cache_hit: result.cacheHit,
            });
          }
          for (const fig of skipped) {
            inspected.push({
              label: fig.label,
              url: fig.url,
              caption_short: fig.caption,
              citation: fig.citation,
              perception: null,
              cache_hit: false,
              truncated: true,
            });
          }

          return JSON.stringify({
            pair_id: inspectPairId,
            citation: buildPairCitation(inspectPairContext),
            side,
            focus: requestedFocus,
            question: question ?? null,
            figures: inspected,
            model: model || null,
            inspected_count: toInspect.length,
            cached_count: cachedCount,
            truncated: skipped.length > 0,
          });
        } catch (err) {
          this.logger.warn(`inspect_figure failed: ${String(err)}`);
          return JSON.stringify({
            error: `inspect_figure failed: ${(err as Error).message}`,
            figures: [],
            inspected_count: 0,
            cached_count: 0,
          });
        }
      },
      {
        name: 'inspect_figure',
        description: INSPECT_FIGURE_TOOL_DESCRIPTION,
        schema: z.object({
          pair_id: z
            .string()
            .describe(
              'Canonical pair handle from search_questions / get_question_pair / etc., ' +
                'e.g. "math-2017-controle-sciences-ex:ex_4:q_1.a".',
            ),
          side: z
            .enum([
              'enonce',
              'corrige',
              'exercise_enonce',
              'exercise_corrige',
              'exam_full_enonce',
              'exam_full_corrige',
            ])
            .describe(
              'Which surface of the pair to inspect. ' +
                '`enonce` / `corrige` target the per-figure crops in ' +
                '`figures.<side>[]` (only valid when that side ships at least ' +
                'one figure). `exercise_enonce` / `exercise_corrige` target ' +
                'the stitched per-exercise scan (`images.exercise_<side>`). ' +
                '`exam_full_enonce` / `exam_full_corrige` target the whole-exam ' +
                'scan (`images.exam_full_<side>`). Corrigé sides are fair game ' +
                'when the student is past the active-recall gate.',
            ),
          figure: z
            .string()
            .optional()
            .describe(
              'Either a figure label like "figure 1" (matching ' +
                'figures.*[].label in search-result payloads) or "all". ' +
                'Defaults to "all". Prefer specific labels to save tokens.',
            ),
          focus: z
            .enum(['general', 'axes', 'values', 'topology', 'text', 'count'])
            .optional()
            .describe(
              'Steers the structured fields the model populates. Default "general".',
            ),
          question: z
            .string()
            .optional()
            .describe(
              'Natural-language question to ground the perception in. ' +
                'Strongly recommended — un-grounded calls produce generic descriptions.',
            ),
        }),
      },
    );
  }

  /**
   * Check + record a call against the per-thread sliding-window budget.
   * Returns the number of inspections still permitted in this window
   * (0 ⇒ over budget). The current call is *not* yet recorded; it
   * gets recorded inside {@link runInspectFigure} only on cache miss
   * (cache hits are free and don't count).
   */
  private checkInspectFigureBudget(threadId: string): number {
    const now = Date.now();
    const windowStart = now - AgentToolsService.INSPECT_FIGURE_BUDGET_WINDOW_MS;
    let stamps = this.inspectFigureCalls.get(threadId);
    if (stamps) {
      // Drop any timestamps that have rolled out of the window.
      stamps = stamps.filter((t) => t >= windowStart);
      if (stamps.length === 0) {
        this.inspectFigureCalls.delete(threadId);
      } else {
        this.inspectFigureCalls.set(threadId, stamps);
      }
    }
    const used = stamps?.length ?? 0;
    return Math.max(0, AgentToolsService.INSPECT_FIGURE_BUDGET_MAX - used);
  }

  private recordInspectFigureCall(threadId: string): void {
    const now = Date.now();
    const arr = this.inspectFigureCalls.get(threadId) ?? [];
    arr.push(now);
    this.inspectFigureCalls.set(threadId, arr);
    // Lazy LRU eviction so the map can't grow unbounded across the
    // process lifetime when many threads call once each.
    if (
      this.inspectFigureCalls.size >
      AgentToolsService.INSPECT_FIGURE_BUDGET_MAX_THREADS
    ) {
      const oldest = this.inspectFigureCalls.keys().next().value;
      if (oldest !== undefined && oldest !== threadId) {
        this.inspectFigureCalls.delete(oldest);
      }
    }
  }

  /**
   * Cache-aware single-figure inspection. Looks up the cache first;
   * falls through to {@link VisionService.analyzeFigure} on miss and
   * persists the result. Returns the analysis along with whether the
   * call hit the cache (so the tool envelope can report it back to
   * the agent).
   */
  private async runInspectFigure(opts: {
    threadId: string;
    relpath: string | null;
    url: string | null;
    caption: string;
    focus: FigureFocus;
    question?: string;
  }): Promise<{
    analysis: VisionAnalysisResult['analysis'];
    model: string;
    cacheHit: boolean;
  }> {
    if (!opts.relpath || !opts.url) {
      return {
        analysis: {
          analysis:
            'Vision non disponible (aucune URL pour cette figure dans la payload).',
          axes: null,
          values: null,
          topology: null,
          text_ocr: null,
          count: null,
          confidence: 0,
        },
        model: '',
        cacheHit: false,
      };
    }

    const cacheKey = {
      relpath: opts.relpath,
      focus: opts.focus,
      question: opts.question,
    };
    const cached = await this.perceptionCache.get(cacheKey);
    if (cached) {
      return {
        analysis: cached.analysis,
        model: cached.model,
        cacheHit: true,
      };
    }

    // Cache miss → spend a slot from the per-thread budget, then call
    // the vision API. We record before the call so a slow/abusive run
    // can't sneak past the budget by being concurrent.
    this.recordInspectFigureCall(opts.threadId);

    const result = await this.vision.analyzeFigure({
      imageUrl: opts.url,
      caption: opts.caption,
      focus: opts.focus,
      question: opts.question,
    });
    if (result.structured && result.analysis.confidence !== 0) {
      // Only memoise non-stub responses so a transient failure
      // doesn't poison the cache.
      await this.perceptionCache.put(cacheKey, result.analysis, result.model);
    }
    return {
      analysis: result.analysis,
      model: result.model,
      cacheHit: false,
    };
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
          // Cheap enrichment: pull a short sample of matching pairs so
          // the agent can immediately suggest 1–2 representative
          // questions / cite a topical span without firing a second
          // expensive search. The scroll is bounded by
          // COUNT_QUESTIONS_SAMPLE_CAP, so the wall-clock cost is
          // dominated by the count round-trip already paid above.
          const sample =
            count > 0
              ? await this.qdrant.scrollByFilter({
                  filter: filter ?? { must: [] },
                  limit: AgentToolsService.COUNT_QUESTIONS_SAMPLE_CAP,
                })
              : [];
          const cdnBase = this.imageCdnBase;
          const samplePairs = sample
            .slice(0, AgentToolsService.COUNT_QUESTIONS_SAMPLE_CAP)
            .map((p) => formatPairForLLM(p, { cdnBase }));
          const summary = summariseSample(sample);
          return JSON.stringify({
            count,
            sample_size: samplePairs.length,
            top_chapters: summary.top_chapters,
            top_topics: summary.top_topics,
            top_exams: summary.top_exams,
            example_pair_ids: samplePairs
              .map((p) => p.pair_id)
              .filter((id) => typeof id === 'string'),
            sample: samplePairs,
          });
        } catch (err) {
          this.logger.warn(`count_questions failed: ${String(err)}`);
          return `Error counting questions: ${(err as Error).message}`;
        }
      },
      {
        name: 'count_questions',
        description:
          'Count corrected, gate-passing Bac questions matching the given ' +
          'filters AND return a small sample (up to ' +
          `${AgentToolsService.COUNT_QUESTIONS_SAMPLE_CAP} pairs) plus ` +
          'aggregated facets (top chapters, topics, exams) so you can ' +
          'immediately cite or suggest a representative question without a ' +
          'second round-trip. Cheap (no embeddings, no reranker) — use this ' +
          'to answer aggregate questions like "how many trigonometry problems ' +
          'do you have?" before deciding whether to do an expensive search.',
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
          // The v6 Neo4j ingest stamps `critic_label`/`under_gate` on Qdrant
          // payloads but skipped them on Pair nodes — both are null on every
          // v6 Pair. We therefore coalesce to the v1 "good" defaults so this
          // filter still excludes any future flagged pair without dropping
          // every v6 row on the floor. (Kept defensively even though v6's
          // taxonomy graph today only contains v1 Pair nodes.)
          const cypher = matiere
            ? `
                MATCH (p:Pair)-[:IN_CHAPTER]->(c:Chapter)
                WHERE c.matiere = $matiere
                  AND coalesce(p.critic_label, 'correct') = 'correct'
                  AND coalesce(p.under_gate, false) = false
                RETURN c.name AS chapter, c.matiere AS matiere, count(p) AS pair_count
                ORDER BY pair_count DESC, chapter ASC
              `
            : `
                MATCH (p:Pair)-[:IN_CHAPTER]->(c:Chapter)
                WHERE coalesce(p.critic_label, 'correct') = 'correct'
                  AND coalesce(p.under_gate, false) = false
                RETURN c.name AS chapter, c.matiere AS matiere, count(p) AS pair_count
                ORDER BY matiere ASC, pair_count DESC, chapter ASC
              `;
          const params: Record<string, unknown> = matiere ? { matiere } : {};
          const result = await session.run(cypher, params);
          return JSON.stringify({
            chapters: result.records.map((r) => {
              const chapterName = r.get('chapter') as string;
              const chapterMatiere = r.get('matiere') as string;
              return {
                chapter: chapterName,
                matiere: chapterMatiere,
                pair_count: toNumber(r.get('pair_count')),
                // Drop-in filter the agent can hand straight to
                // search_questions / count_questions / list_topics
                // without re-typing the chapter name.
                search_filter: {
                  matiere: chapterMatiere,
                  chapter: chapterName,
                },
              };
            }),
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
          // Read the shared v1 topic taxonomy as the source of truth, and
          // coalesce the gate columns so any future v6-shaped pair without
          // the v1 critic/gate properties still passes the safety check.
          const where: string[] = [
            "coalesce(p.critic_label, 'correct') = 'correct'",
            'coalesce(p.under_gate, false) = false',
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
            topics: result.records.map((r) => {
              const topicName = r.get('topic') as string;
              const topicMatiere = r.get('matiere') as string;
              return {
                topic: topicName,
                matiere: topicMatiere,
                pair_count: toNumber(r.get('pair_count')),
                // Drop-in filter for search_questions /
                // count_questions — the agent passes this object
                // verbatim instead of re-typing topic + matiere.
                search_filter: {
                  matiere: topicMatiere,
                  topic: topicName,
                },
              };
            }),
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
          // v6 Pair nodes carry `critic_label`/`under_gate` on the Qdrant
          // payload but NOT on the Neo4j node — both properties are null
          // on every v6 Pair. Filtering with strict equality therefore
          // returned `pair_count = 0` for every v6 exam (the bug fixed in
          // this revision). Coalescing to the "good" defaults treats null
          // the same as v1's correct/open-gate state and still excludes
          // any pair the pipeline later flags.
          const cypher = `
            MATCH (e:Exam)
            ${whereClause}
            OPTIONAL MATCH (p:Pair)-[:FROM_EXAM]->(e)
              WHERE coalesce(p.critic_label, 'correct') = 'correct'
                AND coalesce(p.under_gate, false) = false
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
            exams: result.records.map((r) => {
              const examId = r.get('exam_id') as string;
              const examYear = toNumber(r.get('year'));
              const examSession = r.get('session') as string;
              const subject = r.get('subject') as string;
              const examTrack = r.get('track') as string;
              return {
                exam_id: examId,
                year: examYear,
                session: examSession,
                subject,
                track: examTrack,
                pair_count: toNumber(r.get('pair_count')),
                citation: buildExamCitation({
                  exam_handle: examId,
                  matiere: subject,
                  year: examYear,
                  session: examSession,
                  track: examTrack,
                }),
              };
            }),
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
          //
          // The v6 Neo4j ingest left `critic_label`/`under_gate` null on
          // Pair nodes (those properties live on Qdrant payloads in v6),
          // so coalesce to the v1 "good" defaults — otherwise every v6
          // row falls out of the count. v1 Pair nodes still set both
          // properties, so genuinely flagged pairs are still excluded.
          const cypher = `
            MATCH (p:Pair)-[:FROM_EXAM]->(e:Exam)
            WHERE coalesce(p.critic_label, 'correct') = 'correct'
              AND coalesce(p.under_gate, false) = false
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
   * Implementation note: both `exam_id` and `exam` are keyword-indexed
   * payload fields in Qdrant v6 (`exercise_number` is unindexed), so we
   * scroll on the exam handle and filter by `exercise_number` in Node.
   * The largest exam in the corpus has < 30 sub-questions, well under
   * the scroll cap.
   *
   * Exam-handle compatibility: v6 surfaces TWO exam-shaped payload
   * fields:
   *   - `exam_id` — hyphenated, matiere-prefixed, e.g.
   *     `"math-2017-controle-sciences-ex"`. Same value Neo4j Exam nodes
   *     and `list_exams.exam_id` return, so it is the canonical form.
   *   - `exam`    — legacy v1 underscored handle, e.g.
   *     `"2017_controle_sciences_ex_math"`. Kept on v6 payloads for
   *     backwards compatibility.
   * We try `exam_id` first (the form `list_exams` now returns) and
   * fall back to `exam` so any cached pre-cutover state — or an LLM
   * that parroted an underscored id from older system-prompt examples —
   * still resolves.
   */
  private listExamQuestionsTool(): StructuredToolInterface {
    return tool(
      async ({ exam, exercise_number, limit }) => {
        try {
          let points = await this.qdrant.scrollByFilter({
            filter: {
              must: [{ key: 'exam_id', match: { value: exam } }],
            },
            limit: AgentToolsService.LIST_EXAM_QUESTIONS_SCROLL_CAP,
          });
          if (points.length === 0) {
            points = await this.qdrant.scrollByFilter({
              filter: {
                must: [{ key: 'exam', match: { value: exam } }],
              },
              limit: AgentToolsService.LIST_EXAM_QUESTIONS_SCROLL_CAP,
            });
          }
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
          'Cheap (Qdrant scroll on the indexed `exam_id` field; no ' +
          'embeddings, no rerank).',
        schema: z.object({
          exam: z
            .string()
            .min(1)
            .describe(
              'The exam handle. Canonical form is the hyphenated, ' +
                'matiere-prefixed `exam_id` returned by list_exams ' +
                '(e.g. "math-2017-controle-sciences-ex"). Legacy ' +
                'underscored ids (e.g. "2017_controle_informatique_math") ' +
                'are also accepted for backwards compatibility. Always ' +
                'call list_exams first to discover the exact id.',
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
   *
   * The v6 omni payload renamed / dropped several v4-era fields, so
   * each clause maps the agent's logical name onto the actual indexed
   * v6 keyword. Fields whose v4 source was a Tag (`chapter`, `topic`,
   * `bloom_level`, `answer_format`, `difficulty`) no longer live on
   * the Qdrant payload — they migrated to Neo4j — and are silently
   * dropped here. The agent can still narrow by those facets via the
   * Cypher-backed `list_*` / Neo4j-side tools.
   *
   * Any future mandatory clauses are injected inside the Qdrant client
   * (see {@link MANDATORY_FILTER}).
   */
  private buildQdrantFilterFromArgs(args: {
    matiere?: string;
    /** No-op on v6 (chapter lives on Neo4j only). Kept for API stability. */
    chapter?: string;
    /** No-op on v6 (topic lives on Neo4j only). */
    topic?: string;
    year?: number;
    session?: string;
    track?: string;
    exam?: string;
    /** No-op on v6 (difficulty lives on Neo4j only). */
    difficulty_min?: number;
    /** No-op on v6 (difficulty lives on Neo4j only). */
    difficulty_max?: number;
    /** No-op on v6 (bloom_level lives on Neo4j only). */
    bloom_level?: string;
    /** No-op on v6 (answer_format lives on Neo4j only). */
    answer_format?: string;
    /**
     * When true, restrict to pairs whose énoncé carries at least one
     * figure (`has_figure_enonce=true`). When false, restrict to pairs
     * with no figures on either side.
     */
    requires_figure?: boolean;
  }): QdrantFilter | undefined {
    const must: QdrantCondition[] = [];
    if (args.matiere)
      must.push({ key: 'matiere', match: { value: args.matiere } });
    if (args.year !== undefined)
      must.push({ key: 'exam_year', match: { value: args.year } });
    if (args.session)
      must.push({ key: 'session', match: { value: args.session } });
    if (args.track) {
      const track = normalizeSection(args.track);
      if (track) must.push({ key: 'filiere', match: { value: track } });
    }
    if (args.exam) {
      // v6 hyphenated `exam_id` ("math-2017-controle-sciences-ex") and
      // legacy v1 underscored `exam` ("2017_controle_informatique_math")
      // are distinct payload fields. Pick by shape so callers passing
      // either form land on the right index.
      const examKey = args.exam.includes('-') ? 'exam_id' : 'exam';
      must.push({ key: examKey, match: { value: args.exam } });
    }
    if (typeof args.requires_figure === 'boolean') {
      if (args.requires_figure) {
        // Surfaces énoncé figures (the side the agent reasons about
        // most). Pairs whose figures live only on the corrigé side
        // are still reachable via `inspect_figure` once the agent
        // sees the question pair.
        must.push({ key: 'has_figure_enonce', match: { value: true } });
      } else {
        must.push({ key: 'has_figure_enonce', match: { value: false } });
        must.push({ key: 'has_figure_corrige', match: { value: false } });
      }
    }
    return must.length ? { must } : undefined;
  }
}

// ---- formatting helpers (module-private) -------------------------------

/**
 * v6 R2 layout: every figure asset is namespaced under an `ocr_omni/`
 * directory inside the public bucket. The Qdrant payloads store
 * `*_relpath` strings WITHOUT that prefix (the convention is to hold
 * the prefix at config time), so the URL builder is responsible for
 * inserting it.
 */
const R2_BUCKET_PREFIX = 'ocr_omni';

/**
 * Compose a public asset URL from a v6 image relpath. When
 * `cdnBase` is set (typically `R2_PUBLIC_BASE` env var pointing at
 * the public Cloudflare R2 bucket), `relpath` is appended; otherwise
 * we return the raw relpath so the frontend can compose its own URL
 * or fall back to a "no asset" state without crashing.
 *
 * The function is idempotent on the `ocr_omni/` segment so all three
 * configuration shapes resolve to the same URL — the canonical
 * `…r2.dev/ocr_omni`, the bare bucket origin `…r2.dev`, and the (rare)
 * relpath that already includes the prefix:
 *
 *   buildImageUrl('a/b.png', 'https://x.r2.dev/ocr_omni')
 *     → 'https://x.r2.dev/ocr_omni/a/b.png'
 *   buildImageUrl('a/b.png', 'https://x.r2.dev')
 *     → 'https://x.r2.dev/ocr_omni/a/b.png'   ← was 404 before this fix
 *   buildImageUrl('ocr_omni/a/b.png', 'https://x.r2.dev')
 *     → 'https://x.r2.dev/ocr_omni/a/b.png'
 *
 * Without this normalisation a deployment that set `R2_PUBLIC_BASE`
 * to the bare bucket origin (a subtle config drift — RAILWAY.md
 * documents the canonical form but the env can drift) would ship
 * 404-ing image URLs to the frontend, which then renders every
 * figure as "figure indisponible".
 */
export function buildImageUrl(
  relpath: unknown,
  cdnBase: string | undefined,
): string | null {
  if (typeof relpath !== 'string' || relpath.length === 0) return null;
  const trimmedRel = relpath.replace(/^\/+/, '');
  if (!cdnBase) return trimmedRel;
  const trimmedBase = cdnBase.replace(/\/+$/, '');
  const baseHasPrefix =
    trimmedBase.endsWith(`/${R2_BUCKET_PREFIX}`) ||
    trimmedBase === R2_BUCKET_PREFIX;
  const relHasPrefix = trimmedRel.startsWith(`${R2_BUCKET_PREFIX}/`);
  if (baseHasPrefix || relHasPrefix) {
    return `${trimmedBase}/${trimmedRel}`;
  }
  return `${trimmedBase}/${R2_BUCKET_PREFIX}/${trimmedRel}`;
}

/**
 * One per-figure record surfaced to the agent / frontend chips. The
 * v6 omni ingest stores figures as a flat list of R2 relpaths under
 * `figure_relpaths_{enonce,corrige}`; the v1/v4 ingest used a rich
 * `{label, description, relpath}` shape under `{enonce,corrige}_figures`.
 * {@link readFigureEntries} normalises both into this single contract
 * so downstream code (and the chip surface) doesn't have to branch.
 *
 * On v6 payloads `description` comes back as an empty string and
 * `label` is synthesised as `"Figure N"` from the array index — the
 * caption text the v4 ingest used to attach now lives on the wider
 * `section_*_text` / `exercise_*_text` payload fields and the agent
 * reasons about figures using those directly.
 */
export interface FigureEntry {
  label: string;
  description: string;
  relpath: string;
}

/**
 * Read the per-side figure entries off a Qdrant payload, defensively,
 * normalising across the v1/v4 and v6 payload shapes:
 *
 *   - v1/v4: `enonce_figures` / `corrige_figures` is an array of
 *     `{label, description, relpath}` objects.
 *   - v6 (omni): `figure_relpaths_enonce` / `figure_relpaths_corrige`
 *     is a flat array of relpath strings; per-figure captions /
 *     labels are not emitted by the v6 ingest.
 *
 * Tolerates missing fields, wrong types, and malformed entries — the
 * only contract is that the returned array contains {@link FigureEntry}
 * objects with all three string fields populated. Anything else is
 * silently dropped. Callers must therefore not infer "no figure exists"
 * from an empty return value alone — they must additionally check the
 * four `*_image_relpath` keys for the legacy per-exercise stitched
 * image.
 */
export function readFigureEntries(
  payload: unknown,
  side: 'enonce' | 'corrige',
): FigureEntry[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;

  // Prefer the rich v1/v4 shape when it's populated — it carries the
  // LLM-generated captions the agent reasons about most.
  const richKey = side === 'enonce' ? 'enonce_figures' : 'corrige_figures';
  const richRaw = p[richKey];
  if (Array.isArray(richRaw) && richRaw.length > 0) {
    const out: FigureEntry[] = [];
    for (const item of richRaw) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const label = obj.label;
      const description = obj.description;
      const relpath = obj.relpath;
      if (
        typeof label !== 'string' ||
        typeof description !== 'string' ||
        typeof relpath !== 'string' ||
        relpath.length === 0
      ) {
        continue;
      }
      out.push({ label, description, relpath });
    }
    if (out.length > 0) return out;
  }

  // Fall back to the v6 flat-relpath shape. The ingest doesn't emit
  // per-figure labels / captions, so we synthesise a positional label
  // and leave description empty — the agent reads broader caption
  // text from the `section_*_text` / `exercise_*_text` payload fields
  // instead of per-figure captions on v6.
  const flatKey =
    side === 'enonce' ? 'figure_relpaths_enonce' : 'figure_relpaths_corrige';
  const flatRaw = p[flatKey];
  if (Array.isArray(flatRaw)) {
    const out: FigureEntry[] = [];
    for (const entry of flatRaw) {
      if (typeof entry !== 'string' || entry.length === 0) continue;
      // Label uses the kept-output index so it stays in sync with the
      // `lemma:fig:…:<side>:<n>` citation index (which counts only the
      // valid entries). Clean v6 payloads have no gaps, so this is
      // equivalent to the raw array index in practice.
      out.push({
        label: `Figure ${out.length + 1}`,
        description: '',
        relpath: entry,
      });
    }
    return out;
  }

  return [];
}

/** Max chars per caption surfaced to the LLM in non-`full` tool output. */
const FIGURE_CAPTION_PREVIEW_CHARS = 240;

/** Max chars of caption text appended PER SIDE to the reranker passage. */
const FIGURE_PASSAGE_CHARS_PER_SIDE = 600;

/**
 * One LLM-facing figure record: the caption plus a fully-qualified
 * public URL ready to paste into a Streamdown image or React `<img>`.
 *
 * `citation` is the inline-citation block the agent should drop into
 * prose when referring to this specific figure. It's null only when
 * the caller failed to supply enough metadata to build a stable
 * `lemma:fig:…` URI (no pair_id and no explicit handles) — the agent
 * falls back to descriptive prose without a chip in that case.
 */
export interface FormattedFigure {
  label: string;
  caption: string;
  url: string | null;
  citation: Citation | null;
}

/**
 * Translate the per-side figure entries into the
 * `{label, caption, url, citation}` shape consumed by the agent and
 * the frontend chips. When `full=false` the captions are truncated
 * to {@link FIGURE_CAPTION_PREVIEW_CHARS} so the search-result
 * payload stays compact; `full=true` keeps the full caption (used by
 * `get_question_pair` and `show_question_assets` where the agent /
 * student is committed to one specific pair).
 *
 * `pairContext` carries the metadata needed to build per-figure
 * `lemma:fig:…` citations. Pass it whenever you have a known pair
 * (the search-result formatter, get_question_pair, show_question_assets,
 * inspect_figure). It's intentionally optional so callers without
 * pair context can still reuse the shape — citations come back
 * `null` and the figure renders as a plain thumbnail.
 */
export function formatFiguresForLLM(
  payload: unknown,
  cdnBase: string | undefined,
  opts?: { full?: boolean; pairContext?: CitationContext },
): { enonce: FormattedFigure[]; corrige: FormattedFigure[] } {
  const map = (
    entries: FigureEntry[],
    side: 'enonce' | 'corrige',
  ): FormattedFigure[] =>
    entries.map((f, idx) => ({
      label: f.label,
      caption: opts?.full
        ? f.description
        : truncate(f.description, FIGURE_CAPTION_PREVIEW_CHARS),
      url: buildImageUrl(f.relpath, cdnBase),
      citation: opts?.pairContext
        ? buildFigureCitation(opts.pairContext, side, idx)
        : null,
    }));
  return {
    enonce: map(readFigureEntries(payload, 'enonce'), 'enonce'),
    corrige: map(readFigureEntries(payload, 'corrige'), 'corrige'),
  };
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
 *
 * The `enonce_figures` / `corrige_figures` arrays are surfaced as
 * `figures.{enonce,corrige}[].{label,caption,url}` — caption text is
 * truncated unless `opts.full` is true. The `has_figure_*` /
 * `n_*_figures` fields are *recomputed from the arrays* so callers
 * never see the stale boolean values that survive in the payload
 * for ~600 pairs (the May 9 figures injection populated arrays
 * without rewriting the legacy booleans, so trusting them would hide
 * those pairs from the panel / chip).
 */
export function formatPairForLLM(
  point: QdrantPoint,
  opts?: { full?: boolean; cdnBase?: string },
): Record<string, unknown> {
  const payload = (point.payload ?? {}) as Record<string, unknown>;
  const question = readStringPayload(point, 'question_text') ?? '';
  const answer = readStringPayload(point, 'answer_text') ?? '';
  const cap = AgentToolsService['TEXT_PREVIEW_CHARS'] as number;
  const cdnBase = opts?.cdnBase;
  const pairId = payload.pair_id_logical ?? payload.pair_id ?? null;
  const pairContext: CitationContext = {
    pair_id: typeof pairId === 'string' ? pairId : null,
    matiere: payload.matiere as string | null | undefined,
    year: (payload.year ?? payload.exam_year) as
      | number
      | string
      | null
      | undefined,
    session: payload.session as string | null | undefined,
    track: (payload.track ?? payload.filiere) as string | null | undefined,
    exercise_number: payload.exercise_number as
      | number
      | string
      | null
      | undefined,
    question_number: payload.question_number as string | null | undefined,
  };
  const figures = formatFiguresForLLM(payload, cdnBase, {
    full: opts?.full,
    pairContext,
  });
  const citation = buildPairCitation(pairContext);
  const exerciseCitation = buildExerciseCitation(pairContext);
  const examCitation = buildExamCitation({
    exam_handle:
      pairContext.exam_handle ??
      parsePairId(pairContext.pair_id)?.exam_handle ??
      null,
    matiere: pairContext.matiere,
    year: pairContext.year,
    session: pairContext.session,
    track: pairContext.track,
  });
  return {
    pair_id: pairId,
    citation,
    exercise_citation: exerciseCitation,
    exam_citation: examCitation,
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
    // Recomputed from the arrays — never read the stale payload
    // booleans here; see component-level comment.
    has_figure_enonce: figures.enonce.length > 0,
    has_figure_corrige: figures.corrige.length > 0,
    n_enonce_figures: figures.enonce.length,
    n_corrige_figures: figures.corrige.length,
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
    figures,
    reference_doc: buildReferenceDocSummary(payload),
    score: typeof point.score === 'number' ? point.score : undefined,
  };
}

/**
 * Compact `reference_doc` summary emitted on every `formatPairForLLM`
 * result. The full dossier text + figures live behind
 * `show_question_assets` and the agent's LLM-context builder
 * (`collectReferenceDocsForLLM`) — search hits only need the
 * "this exam has a dossier, here's how big" signal so the agent
 * knows when to fetch it. Returns `null` when the pair doesn't ship
 * a dossier (non-technique matières today).
 */
function buildReferenceDocSummary(payload: Record<string, unknown>): {
  kind: string;
  kind_label: string;
  n_pages: number;
  n_figures: number;
  text_full_length: number;
  split_method: string | null;
} | null {
  const raw = readReferenceDoc(payload);
  if (!raw) return null;
  return {
    kind: raw.kind,
    kind_label: referenceDocKindLabel(raw.kind),
    n_pages: raw.pages.length,
    n_figures: raw.figures.length,
    text_full_length: raw.text.length,
    split_method: raw.split_method,
  };
}

/**
 * Build the text passage shown to the cross-encoder reranker for a
 * single Qdrant point. Includes the question, the answer (so the
 * reranker can score against either one), and — when present — the
 * figure captions joined together. The caption block is what lets a
 * query like `"circuit RC charge condensateur"` rerank a pair higher
 * even when the énoncé text doesn't mention either word but the
 * figure caption does.
 *
 * Per-side caption text is capped at
 * {@link FIGURE_PASSAGE_CHARS_PER_SIDE} so a single figure-heavy pair
 * can't dominate the passage and overpower the question/answer
 * signal.
 */
export function formatRerankPassage(point: QdrantPoint): string {
  const q = readStringPayload(point, 'question_text') ?? '';
  const a = readStringPayload(point, 'answer_text') ?? '';
  const enonceCaptions = joinCaptions(
    readFigureEntries(point.payload, 'enonce'),
    FIGURE_PASSAGE_CHARS_PER_SIDE,
  );
  const corrigeCaptions = joinCaptions(
    readFigureEntries(point.payload, 'corrige'),
    FIGURE_PASSAGE_CHARS_PER_SIDE,
  );
  const lines = [`Question: ${q}`, `Answer: ${a}`];
  if (enonceCaptions) lines.push(`Figures énoncé: ${enonceCaptions}`);
  if (corrigeCaptions) lines.push(`Figures corrigé: ${corrigeCaptions}`);
  return lines.join('\n');
}

/**
 * Side-aware figure-availability post-filter for `search_questions`.
 *
 * Applied AFTER rerank because Qdrant filters can't reliably express
 * "this array payload field is non-empty" on our schema (the `is_empty`
 * operator isn't part of `QdrantCondition`, and the legacy
 * `has_figure_*` booleans are stale on ~600 pairs after the May 9
 * figures injection — a Qdrant-side filter on those would silently
 * hide pairs that actually have figures). Post-filtering on the
 * authoritative arrays guarantees the agent's `figures_required`
 * promise is kept exactly.
 */
function applyFiguresRequiredFilter(
  points: QdrantPoint[],
  required: 'enonce' | 'corrige' | 'either' | 'none' | 'any' | undefined,
): QdrantPoint[] {
  if (!required || required === 'any') return points;
  return points.filter((p) => {
    const enonceLen = readFigureEntries(p.payload, 'enonce').length;
    const corrigeLen = readFigureEntries(p.payload, 'corrige').length;
    switch (required) {
      case 'enonce':
        return enonceLen > 0;
      case 'corrige':
        return corrigeLen > 0;
      case 'either':
        return enonceLen > 0 || corrigeLen > 0;
      case 'none':
        return enonceLen === 0 && corrigeLen === 0;
      default:
        return true;
    }
  });
}

function joinCaptions(entries: FigureEntry[], maxChars: number): string {
  if (entries.length === 0) return '';
  const parts: string[] = [];
  let used = 0;
  for (const e of entries) {
    const desc = e.description.trim();
    if (!desc) continue;
    const piece = `[${e.label}] ${desc}`;
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    if (piece.length <= remaining) {
      parts.push(piece);
      used += piece.length + 2; // +2 for the joining `; `
    } else {
      parts.push(`${piece.slice(0, Math.max(0, remaining - 1))}…`);
      break;
    }
  }
  return parts.join('; ');
}

/**
 * One entry in the `inspect_figure` tool response. Mirrors the
 * frontend-visible perception envelope so the agent can pattern-match
 * fields directly off the tool output. `truncated=true` flags figures
 * the per-thread budget pushed into "next window" without inspecting.
 */
interface InspectFigureEntry {
  label: string;
  url: string | null;
  caption_short: string;
  citation: Citation | null;
  perception: VisionAnalysisResult['analysis'] | null;
  cache_hit: boolean;
  truncated?: boolean;
}

/**
 * Resolve a `figure` selector to the formatted figures it targets.
 * Accepts:
 *   - `"all"` / empty / unknown → return all figures on the side
 *   - `"figure 1"` / `"figure_1"` / `"f1"` → label match (case-insensitive,
 *     space/underscore-insensitive)
 *   - a positive integer → 1-based index into the side's figures
 */
function filterFiguresBySelector(
  figures: FormattedFigure[],
  selector: string,
): FormattedFigure[] {
  const norm = selector.toLowerCase().replace(/[\s_]/g, '');
  if (norm === '' || norm === 'all') return figures;
  // Numeric selector → 1-based index
  if (/^\d+$/.test(norm)) {
    const i = Number.parseInt(norm, 10) - 1;
    return i >= 0 && i < figures.length ? [figures[i]] : [];
  }
  const match = figures.find(
    (f) => f.label.toLowerCase().replace(/[\s_]/g, '') === norm,
  );
  return match ? [match] : [];
}

/**
 * Look up the storage relpath for a figure label on a given side.
 * The cache is keyed on relpath so we must read it from the canonical
 * payload entries, NOT from the URL (which has the CDN base baked in
 * and is environment-specific).
 */
function readRelpathForLabel(
  payload: unknown,
  side: 'enonce' | 'corrige',
  label: string,
): string | null {
  const norm = label.toLowerCase().replace(/[\s_]/g, '');
  for (const e of readFigureEntries(payload, side)) {
    if (e.label.toLowerCase().replace(/[\s_]/g, '') === norm) {
      return e.relpath;
    }
  }
  return null;
}

/**
 * The expanded `side` enum for `inspect_figure`. The legacy two
 * values target the per-figure crops in `figures.<side>[]`; the four
 * `*_image_relpath`-backed values target the stitched whole-page
 * scans (one image per side). Splitting the surfaces lets the agent
 * recover gracefully on info / éco exams that ship a single
 * exam-wide scan instead of per-figure crops.
 */
type InspectFigureSide =
  | 'enonce'
  | 'corrige'
  | 'exercise_enonce'
  | 'exercise_corrige'
  | 'exam_full_enonce'
  | 'exam_full_corrige';

/**
 * Map an `InspectFigureSide` to the Qdrant payload key carrying its
 * R2 relpath. `null` for the per-figure sides — those resolve via
 * `readRelpathForLabel` instead.
 */
function wholePageRelpathKey(
  side: InspectFigureSide,
): keyof PayloadShape | null {
  switch (side) {
    case 'exercise_enonce':
      return 'exercise_enonce_image_relpath';
    case 'exercise_corrige':
      return 'exercise_corrige_image_relpath';
    case 'exam_full_enonce':
      return 'exam_full_enonce_relpath';
    case 'exam_full_corrige':
      return 'exam_full_corrige_relpath';
    default:
      return null;
  }
}

interface PayloadShape {
  exercise_enonce_image_relpath?: unknown;
  exercise_corrige_image_relpath?: unknown;
  exam_full_enonce_relpath?: unknown;
  exam_full_corrige_relpath?: unknown;
}

/**
 * Resolve the R2 relpath for a whole-page side. `null` when the
 * payload doesn't ship a scan for that side, OR when the requested
 * side is one of the per-figure sides (in which case the relpath
 * comes from {@link readRelpathForLabel} instead).
 */
function readWholePageRelpath(
  payload: Record<string, unknown>,
  side: InspectFigureSide,
): string | null {
  const key = wholePageRelpathKey(side);
  if (!key) return null;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Synthesise a single `FormattedFigure`-shaped entry from a whole-page
 * scan so the rest of `inspect_figure`'s pipeline (budget, cache,
 * perception, response shape) can treat both surfaces uniformly. The
 * `label` mirrors the side so it's still useful in the response.
 */
function buildWholePageFigure(
  payload: Record<string, unknown>,
  side: InspectFigureSide,
  cdnBase: string | undefined,
): FormattedFigure | null {
  if (side === 'enonce' || side === 'corrige') return null;
  const relpath = readWholePageRelpath(payload, side);
  const url = buildImageUrl(relpath, cdnBase);
  if (!relpath || !url) return null;
  // No caption ships for whole-page scans — the agent only reaches
  // here when it's already decided the per-figure path failed, so a
  // placeholder is fine.
  const caption = `Scan complet (${side}). Pas de caption pré-générée.`;
  // Whole-page scans don't have a stable `lemma:fig:…` URI — the
  // citation scheme is per-figure-index inside `figures.<side>[]`.
  // Returning `null` here keeps the rest of the pipeline happy and
  // avoids minting a URI that wouldn't resolve.
  return {
    label: side,
    caption,
    url,
    citation: null,
  };
}

/**
 * Render the rich "no figures on this side" error envelope. Surfaces
 * the per-side figure counts AND the URLs of the whole-page scans so
 * the agent has enough context to either pick a different side, fall
 * back to the page-level scan, or simply stop calling the tool for
 * this pair (the `no_visual_content` code).
 */
function buildNoFiguresOnSideError(args: {
  pair_id: string;
  side: InspectFigureSide;
  payload: Record<string, unknown>;
  cdnBase: string | undefined;
  allFigures: { enonce: FormattedFigure[]; corrige: FormattedFigure[] };
}): {
  error: string;
  has_figure_enonce: boolean;
  has_figure_corrige: boolean;
  images: {
    exercise_enonce: string | null;
    exercise_corrige: string | null;
    exam_full_enonce: string | null;
    exam_full_corrige: string | null;
  };
  figures: never[];
  inspected_count: 0;
  cached_count: 0;
} {
  const { pair_id, side, payload, cdnBase, allFigures } = args;
  const has_figure_enonce = allFigures.enonce.length > 0;
  const has_figure_corrige = allFigures.corrige.length > 0;
  const images = {
    exercise_enonce: buildImageUrl(
      payload.exercise_enonce_image_relpath,
      cdnBase,
    ),
    exercise_corrige: buildImageUrl(
      payload.exercise_corrige_image_relpath,
      cdnBase,
    ),
    exam_full_enonce: buildImageUrl(payload.exam_full_enonce_relpath, cdnBase),
    exam_full_corrige: buildImageUrl(
      payload.exam_full_corrige_relpath,
      cdnBase,
    ),
  };
  const noVisualContent =
    !has_figure_enonce &&
    !has_figure_corrige &&
    !images.exercise_enonce &&
    !images.exercise_corrige &&
    !images.exam_full_enonce &&
    !images.exam_full_corrige;
  // Compose a single error string that names the failure mode and
  // enumerates the agent's recovery options — the agent should be
  // able to act on this without re-querying the payload.
  const altSides: string[] = [];
  if (side !== 'enonce' && has_figure_enonce) altSides.push('enonce');
  if (side !== 'corrige' && has_figure_corrige) altSides.push('corrige');
  if (side !== 'exercise_enonce' && images.exercise_enonce)
    altSides.push('exercise_enonce');
  if (side !== 'exercise_corrige' && images.exercise_corrige)
    altSides.push('exercise_corrige');
  if (side !== 'exam_full_enonce' && images.exam_full_enonce)
    altSides.push('exam_full_enonce');
  if (side !== 'exam_full_corrige' && images.exam_full_corrige)
    altSides.push('exam_full_corrige');
  const message = noVisualContent
    ? `no_visual_content: pair_id="${pair_id}" has no figures and no page-level scans on any side. Do not call inspect_figure for this pair again — answer from question_text / answer_text instead.`
    : `No content on side="${side}" for pair_id="${pair_id}". ` +
      (altSides.length > 0
        ? `Available sides: ${altSides.join(', ')}.`
        : 'No alternative sides ship content either.');
  return {
    error: message,
    has_figure_enonce,
    has_figure_corrige,
    images,
    figures: [],
    inspected_count: 0,
    cached_count: 0,
  };
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
 * Aggregate a sample of Qdrant points into the small facet summary
 * surfaced by `count_questions`: the top chapters / topics / exams
 * that appear in the sample, ordered by frequency. Used so the agent
 * can immediately suggest "this filter mostly hits chapter X" without
 * firing a second search.
 *
 * Bounded output (top 5 of each) so the payload stays small even on
 * a large sample.
 */
function summariseSample(points: QdrantPoint[]): {
  top_chapters: { chapter: string; count: number }[];
  top_topics: { topic: string; count: number }[];
  top_exams: { exam_id: string; count: number }[];
} {
  const chapterCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const examCounts = new Map<string, number>();
  for (const p of points) {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    const chapter = payload.chapter;
    if (typeof chapter === 'string' && chapter.length > 0) {
      chapterCounts.set(chapter, (chapterCounts.get(chapter) ?? 0) + 1);
    }
    const topics = payload.topics;
    if (Array.isArray(topics)) {
      for (const t of topics) {
        if (typeof t === 'string' && t.length > 0) {
          topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
        }
      }
    }
    const examId = payload.exam_id ?? payload.exam;
    if (typeof examId === 'string' && examId.length > 0) {
      examCounts.set(examId, (examCounts.get(examId) ?? 0) + 1);
    }
  }
  const topN = <K extends string>(
    map: Map<string, number>,
    key: K,
  ): ({ [P in K]: string } & { count: number })[] =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([name, count]) => ({ [key]: name, count }) as never);
  return {
    top_chapters: topN(chapterCounts, 'chapter') as {
      chapter: string;
      count: number;
    }[],
    top_topics: topN(topicCounts, 'topic') as {
      topic: string;
      count: number;
    }[],
    top_exams: topN(examCounts, 'exam_id') as {
      exam_id: string;
      count: number;
    }[],
  };
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
