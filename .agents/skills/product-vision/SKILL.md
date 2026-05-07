---
name: product-vision
description: Lemma's product roadmap for moving the BacPrep AI tutor beyond a markdown-only chat. Covers (1) the Teacher Protocol — the 7-step internal reasoning skeleton the agent must run before any answer; (2) renderable agent output blocks (Hint Ladder, Past-Paper Chip, *Comment penser à ça*, *Dans la vraie vie*, *Ce que les correcteurs cherchent*, Concept Map, Stepwise Cards, Variant Generator, Mock Exam, Free-Body / Process / Trace-Table / ER blocks, etc.); (3) dedicated chat thread types ("Tuteur", "Vibe Exam", "Drill", "Diagnose", "Explore", "Build"); (4) the three content assets that are the actual moat (Pattern Atlas, Mistake Corpus, Analogy Library); (5) library shortlist for new render surfaces (mafs / MathLive / manim-web / Excalidraw / matter.js / etc.); and (6) the "Show-your-work pad" structured input. Future sessions should treat this as the source of truth for product direction without needing the user to re-explain.
---

# Lemma — product vision (renderable agent outputs + chat thread types)

This is the canonical reference for Lemma's product roadmap beyond the v1 chat surface. The user (`dinzabisgod8`, Tunisian BAC product) wants the agent to output more than markdown bubbles, and to support distinct chat *modes* tailored to specific student needs (revising, mock exams, drilling, diagnosing mistakes, exploring the curriculum, building exercises). Future Devin sessions should consult this file *first* before proposing UI/agent changes.

## Where Lemma is today (snapshot, May 2026)

- **Surface**: Next.js 16 App Router; chat threads at `/c/[id]`, the launchpad / new-chat at `/new`. The transcript is rendered by `frontend/components/chat/LemmaConversation.tsx` using `<MessageResponse>` (Streamdown) and `<LemmaToolCall>`.
- **Streaming**: agent run lifecycle is decoupled from the HTTP response (see `.agents/skills/chat-streaming/SKILL.md`). `RunStreamHub` buffers wire chunks; `/chat/stream` and `/chat/stream/resume` both subscribe to the hub. Reload-on-stream is supported.
- **Rendering**: Streamdown plugins are wired up — `@streamdown/cjk`, `@streamdown/code`, `@streamdown/math` (KaTeX), `@streamdown/mermaid`. `katex.min.css` and `streamdown/styles.css` are imported in `app/layout.tsx`.
- **Agent**: LangGraph orchestration in `backend/src/agent/`, NVIDIA NIM models, system prompt currently a single tutor persona.
- **Knowledge**: Neo4j (curriculum graph — programme officiel topics + edges), Qdrant (vector store over BAC past papers and corrigés), NIM embed/rerank for retrieval.
- **Existing multi-mode UI**: `PromptComposer` already has input modes (Reasoning / Exam Prep / Summaries). This is the seed for the thread-type system below — extend that pattern from "input mode" to "thread type".
- **Existing tool surface**: `write_todos` (already produces a live plan panel above the chat via `<TodoPlanPanel />`); various RAG / search tools.

## Where Lemma is going — at a glance

Two parallel evolutions, intended to ship together:

1. **Renderable agent output blocks** (Part A) — new tool calls the agent emits that the frontend renders as rich, interactive UI rather than markdown text.
2. **Chat thread types / modes** (Part B) — distinct entry-points on `/new` (Tuteur / Vibe Exam / Drill / Diagnose / Explore / Build), each with its own system-prompt overlay, tool allow-list, and chat-surface render. **Single agent under the hood** — modes are configurations, NOT separate agents.

The tier-S "wow" features (Part C) are bigger lifts that compound on top of A + B.

Three layers were added in the second revision of this doc (after the user pushed back with *"the libraries are nice, but I still don't see how the agent can be a real **teacher**"*):

3. **The Teacher Protocol** (Part A.0 below) — a 7-step internal reasoning skeleton the agent MUST run *before* writing any answer. Without this skeleton, more UI blocks just produce a smarter ChatGPT. With it, the agent's voice changes from "search engine that answers" to "teacher that explains".
4. **Three content assets** (Part E) — Pattern Atlas, Mistake Corpus, Analogy Library. These are not code; they are curated knowledge specific to the Tunisian BAC. They are the actual moat — competitors cannot replicate them, and the Teacher Protocol queries them on every turn.
5. **Library shortlist + input modality** (Parts F + G) — concrete picks for which open-source / freemium libraries fit each new block, plus a "Show-your-work pad" structured input so the agent can finally read the student's sketch / equation / annotation, not just text.

---

## Part A.0 — The Teacher Protocol (the agent's required internal reasoning)

The single most important architectural change in this doc. **A protocol the agent runs internally before composing any reply to a problem-shaped student message.** Implemented as a structured suffix to the system prompt + 3 new tool calls. No new infrastructure.

A great Tunisian BAC tutor (a real `prof particulier`, the gold standard) does ~7 things the agent does NOT do today:

1. **Diagnoses before answering.** Never solves cold. Asks "*c'est quel sous-question qui te bloque ?*" or "*t'as essayé quoi ?*" first.
2. **Names the genre.** "OK c'est un exercice de forme exponentielle. Le BAC en met **un** chaque année. La structure est toujours la même : module → argument → identité trigonométrique."
3. **Surfaces the canonical recipe.** For every topic there's a 3-step procedure that works ~90% of the time. Teachers know it cold; students need to be *told* it explicitly.
4. **Calls out the trap.** "Les correcteurs du BAC cachent toujours une erreur de signe à l'étape 2. 0.5 point si tu la repères."
5. **Anchors with a Tunisian real-life analogy.** Not "imagine a pizza" — `le tarif du louage` for affine functions, `le M5 vers La Marsa` for cinematique, `l'aiguille des secondes d'une montre` for forme exponentielle.
6. **Makes the student predict the next step.** Sentences end in question marks.
7. **Hands off after the answer.** "Maintenant fais la même avec cos."

The Phase-1 blocks (A1 / A4 / A6) cover (1), (3), (6), (7) implicitly. The protocol introduces (2), (4), (5) — which are what makes a teacher's voice fundamentally different from ChatGPT's voice — and forces them to fire on **every problem-shaped turn**, not whenever the LLM happens to feel like it.

### The 7 steps

```
For every student message that contains a problem or a question:

1. RECOGNIZE — what canonical BAC pattern is this?
   → query: search_questions(...) for similarity ≥ 0.8 → genre + similar past papers.

2. RECALL THE RECIPE — what's the standard 3-step procedure for this genre?
   → query: recall_recipe(topic_id) → canonical procedure + 3 known variations.

3. RECALL THE TRAP — what's the typical Tunisian student mistake here?
   → query: recall_typical_mistake(topic_id) → 1-3 frequent wrong answers + diagnostic.

4. RECALL THE ANCHOR — what concrete Tunisian real-life analogy makes this click?
   → query: recall_analogy(topic_id) → 1 grounded example.

5. DIAGNOSE — what does the student already know? what have they tried?
   → if the student didn't show working AND the problem isn't trivial:
       ask ONE diagnostic question and STOP. Don't answer yet.
   → otherwise: continue.

6. COMPOSE — pick the response shape based on diagnostics:
   → student stuck at start          → Hint Ladder rung 1 + Anchor (A12)
   → student stuck mid-step          → Hint Ladder rung 2-3 targeted at that step
   → student wrong answer            → Error-Diagnosis Card (A5) + Trap callout
   → student wants full solution     → Stepwise Cards (A4) + Recipe pinned at top (A11)
   → student already understood      → Variant Generator (A6) + handoff

7. HAND OFF — never end without a "now you try" or a "predict the next step".
   → if the response was a full solution, ALWAYS append a Variant suggestion.
   → if the response was a hint, ALWAYS append a "type back what you got" prompt.
```

### New tool calls the protocol depends on

| Tool | Returns | Backed by |
|---|---|---|
| `recall_recipe(topic_id)` | `{canonical_recipe: [...], typical_exam_framings: [...], variations: [...]}` | **Pattern Atlas** (Part E.1) |
| `recall_typical_mistake(topic_id)` | `[{mistake, wrong_pattern, diagnostic, correction_hint}]` | **Mistake Corpus** (Part E.2) |
| `recall_analogy(topic_id)` | `{short_anchor, full_explanation}` | **Analogy Library** (Part E.3) |

Without the three content assets in Part E, these tools return empty / generic results and the protocol degrades to "be a slightly better ChatGPT". With them, the agent feels like a teacher.

### Architectural placement

- **Same agent, same LangGraph.** The protocol lives entirely in the system prompt + 3 new tools that hit Postgres / a static JSON / Neo4j. Do NOT fork the agent.
- **Same mode infrastructure (Part B).** Each mode's `system_prompt_suffix` *appends* further constraints (e.g. Diagnose forbids step 6 from picking "full solution" without a second explicit student request). The base protocol is mode-agnostic.
- **Falls back gracefully.** If the topic isn't covered by the Atlas yet, `recall_recipe` returns `{covered: false}` and the agent skips step 2 instead of stalling. Same for steps 3 and 4. This makes incremental rollout safe — you can light up `forme exponentielle` first without blocking everything else.

---

## Part A — Renderable agent outputs (new tool calls)

Each block below is **one tool the agent learns to call** plus **one frontend renderer** in `LemmaConversation.tsx` / a sibling component. The wire format extends `UIMessageChunk` with new `tool-*` part types. No new infrastructure needed; everything below uses the existing LangGraph + Streamdown + Neo4j + Qdrant stack.

Ranked by impact-to-effort.

### A1. Hint Ladder ★ highest pedagogical ROI

**Tool call:** `emit_hint_ladder({ problem_summary, rungs: [tiny_nudge, technique, first_move, full_solution] })`

**Student sees:** four collapsed pills:
1. *Tiny nudge* — one-sentence steer ("look at the modulus before the argument").
2. *Which technique* — the high-level approach ("use the trigonometric form of complex numbers").
3. *First move* — only the first line of the working.
4. *Full solution* — gated; only revealed after the student has opened ≥2 of the rungs above.

**Why it matters.** ChatGPT *cannot* do this — it dumps the full answer. Hint Ladder forces the student to do as much of the thinking as they can before peeking, which is the only setup that actually produces learning. This is the single highest-leverage change in the catalog.

**Soft gate, not a hard lock (revision).** The earlier draft of this block hard-locked rung 4 until the student opened ≥2 prior rungs. That is paternalistic and frustrates strong students who already know the technique and just want to verify step 7. The current spec is:

- *Default* (Tuteur mode): rung 4 is dimmed with a tooltip "Try the smaller hints first — that's where the learning is." It is *clickable*, just visually de-emphasised.
- *Diagnose mode only*: rung 4 is genuinely hard-locked. The system-prompt overlay for Diagnose forbids the agent from emitting rung 4 unless the student has explicitly asked twice.
- Track per-user how often they skip the ladder; if their skip rate is high over a week, surface a one-time nudge: *"On dirait que tu sautes souvent les indices. Essaie le mode Drill — t'auras le pattern dans les doigts plus vite."*

**Effort:** ~3–4 days. New `tool-hint-ladder` part type → renders as a stacked accordion. Agent learns it from the system prompt + 5–10 few-shot examples.

### A2. Past-Paper Context Chip ★ trust signal, cheapest

**Tool call:** `emit_past_paper_match({ year, session, track, exercise, sub_question, typical_marks, similarity_pct })`

**Student sees:** a chip pinned to the assistant's turn:
> 📜 BAC 2019 · Session principale · Mathématiques · Ex. 2 Q3 · 4 marks · 87% match

Tap → opens the official corrigé.

**Why it matters.** Pure use of your existing Qdrant. Every time a student pastes a problem, the agent silently checks "is this a known BAC question or a near-clone?". When the similarity exceeds a threshold (~0.8), the chip appears. Three effects:
- Trust ("the AI knows my exam").
- Strategic intuition ("this exact pattern was a 4-mark question in 2019").
- Anti-hallucination — the chip links to the *real* corrigé so the student can verify.

**Effort:** ~2 days. Retrieval is already there; you add a metadata-shaped tool emit + a small chip component.

### A3. Concept-Map Slice (uses Neo4j directly)

**Tool call:** `emit_concept_map({ focus_node_id, depth: 1, highlight_path: [...] })`

**Student sees:** a small SVG graph of ~5–8 nodes around the topic the question tests. Prerequisite topics in one colour, dependents in another, the focus node pulsing. Hovering / tapping a node opens a one-line definition + offers to "study this prerequisite" or "open a problem on this".

Example for a complex-numbers question: focus = *Forme exponentielle*; prerequisites shown = *Module/argument*, *Trigonométrie*, *e^{ix} identité d'Euler*; dependent = *Racines n-èmes*.

**Why it matters.** You already have the Neo4j curriculum graph. Today it does nothing the student sees. Surfacing a tiny slice on every answer turns "I solved Q3" into "I solved Q3 *and* I now know which 4 topics it lives next to". Massive recall gain + a place to navigate to next.

**Effort:** ~1 week. Pull `1`-hop neighbourhood from Neo4j → encode as `{nodes, edges}` → render with `react-flow` (MIT, mature) or vanilla SVG. The hard part is *curating which* nodes to show; everything else is plumbing.

### A4. Stepwise Solution Cards (with "Predict the next step" gate)

**Tool call:** `emit_solution_steps([{ latex, justification, common_mistake?, predict_next?: bool }, ...])`

**Student sees:** a numbered card stack. By default *all* cards are folded; only the title is visible (`Step 1 · Convert to exponential form`). Tap to expand → equation + justification + an optional `⚠ Common mistake here:` callout. Some cards have a `🤔 Predict the next step` mode where the next card stays hidden until the student types or selects what they think the next move is.

**Why it matters.** Replaces the wall-of-LaTeX response shape with a structure that *forces* engagement step by step. The "Predict the next step" cards are active recall — the highest-leverage learning intervention there is.

**Effort:** ~4–5 days. New `tool-solution-steps` part type. The `predict_next` mode reuses the existing chat input.

### A5. Error-Diagnosis Card

**Tool call:** `emit_error_diagnosis({ student_attempt_latex, correct_latex, error_type, error_location, fix_hint })`

**Student sees:** a structured card after they paste their own attempt:
> ⚠ Sign error · Step 2
> Your line: `1 − i√3 = ...`
> Correct line: `1 + i√3 = ...`
> The imaginary part of `1 + i√3` is `+√3`, not `−√3`. Possible mix-up with `1 − i√3`.

**Why it matters.** Targeted feedback on the student's own working is the second-highest-leverage tutoring move (after Hint Ladder). Aggregated across sessions it produces a per-student "mistakes I make" panel — the platform's compounding moat.

**Effort:** ~5–6 days. Needs a small symbolic-equality check before emitting (otherwise the LLM hallucinates errors). Use `mathjs` (Node) or a thin Python sidecar with `sympy` for stronger CAS.

### A6. Variant Generator ★ most-asked student behaviour

**Tool call:** `emit_variants({ source_problem, count: 5, vary: ["coefficients", "wording"] })`

**Student sees:** a `🎲 Generate variants` button under every solved exam question. Tap → 5 cards with the same problem structure but new numbers / new wording. Each card has a `Solve` button that opens it as a fresh thread (or as the next item in a Drill thread — see Part B).

**Why it matters.** "I understood Q3, but can I do another like it tomorrow?" is THE canonical revision question. Today: textbooks have 1 worked example + 2 exercises; ChatGPT generates one variant if you beg. Lemma should give endless drill on the exact pattern just learned.

**Effort:** ~3 days.

### A7. Difficulty Ladder

**Tool call:** `emit_exercise_ladder({ topic, rungs: ["foundation", "standard", "bac_level"] })`

**Student sees:** three exercises on the same concept, side by side:
- *Foundation* — no obstacles, just compute.
- *Standard* — one twist.
- *BAC-level* — the multi-part question that actually appears on the exam.

**Why it matters.** Students don't know what difficulty their next exercise should be. The ladder lets them self-calibrate without judgement.

**Effort:** ~3 days.

### A8. Mock-Exam Generator (the marquee feature)

**Tool call:** `emit_mock_exam({ duration_min: 240, exercises: [...], mark_scheme: [...] })`

**Student sees:** a full BAC-format paper rendered in the thread:
> Exercice 1 (5 marks) · Exercice 2 (4 marks) · ... · Total /20

Countdown timer at the top. Chat input is *hidden* until the student taps `Submit attempt`. Submission triggers grading via the embedded mark scheme + one Error-Diagnosis Card (A5) per mistake.

The exercises are pulled from the Qdrant past-paper corpus (70%) + Variant Generator (30%) so the paper isn't memorisable by re-running.

**Why it matters.** The single most-asked-for feature in any exam-prep app: "give me a realistic mock paper under exam conditions". Lemma uniquely can do this on demand for any topic combination because it has the past-paper corpus + the curriculum graph.

**Honest scope on grading (revision).** The earlier draft summarised the grading step as "agent grades using mark scheme + emits one Error-Diagnosis Card per mistake". That sentence hides the hardest bit of the entire vision. Real Tunisian BAC mark schemes are partial-credit-heavy (e.g. *"0.5 pour la mise en équation, 0.5 pour la résolution, 0.5 pour la vérification"*). An LLM grading against unstructured mark-scheme prose will: drift across sub-questions, hallucinate that a missing `vérification` step is present, refuse partial credits, and silently disagree with itself on re-runs. Do NOT ship Vibe Exam without:

1. **A structured mark-scheme schema, not free-text.** Each rubric item: `{description, points, requires: ['equation_x', 'value_y'], optional: bool, partial_credit_rules: [...]}`.
2. **A grading agent run *separate* from the answering LLM,** with its own system prompt, its own temperature, and a forced JSON output of `{rubric_id: {awarded_points, justification, evidence_quote}}`. Same LangGraph, just a different node — see the architectural rule in Part B.
3. **A human-correction loop on a small N of submissions** before turning grading on at scale. Calibrate against an actual `prof correcteur` for the first 50 mock papers.

**Effort:** ~2 weeks for v1 paper *generation*, **+1.5 weeks for the grading layer**, ~4 weeks polished total. This is the natural backbone of the *Vibe Exam* mode (Part B, B2).

### A9. Cross-Topic Problem (uses Neo4j to find lonely-edge pairs)

**Tool call:** `emit_cross_topic_problem({ topics: ["complex_numbers", "trigonometry"], target_difficulty: "bac" })`

**Student sees:** a single problem that genuinely requires both topics to solve.

**Why it matters.** The BAC habitually mixes topics in the last sub-question of each exercise (the high-mark, high-difficulty one). Most students drill topics in isolation and get caught out. Use Neo4j to find pairs of topics that are *connected in the curriculum* but typically *taught separately* (or, per-student: not yet drilled together by this user).

**Effort:** ~5 days.

### A10. Reverse Problem ("given the answer, write the question")

**Tool call:** `emit_reverse_problem({ given_answer_latex })`

**Student sees:** a card "Write a question whose answer is `cos(π/12) = (√6 + √2)/4`. Then check yours against the agent's." A textbox to write their own question, then a `Compare` button.

**Why it matters.** Constructing a problem that yields a given answer is the highest possible test of pattern understanding. No competitor offers this in chat form.

**Effort:** ~4 days.

---

### A11. *Comment penser à ça* — the thinking-frame card ★ Teacher Protocol surface #1

**Tool call:** `emit_thinking_frame({ genre, recipe: [...], typical_trap, related_topics: [...] })`

**Student sees:** a card pinned at the **top** of the assistant's turn, before any working:

> 🧭 **Comment penser à ça**
> *Genre :* forme exponentielle (le BAC en met **un** chaque année)
> *Recette :* (1) module → (2) argument → (3) écriture e^{iθ}
> *Piège classique :* 95% des étudiants oublient le signe de l'argument quand l'imaginaire est négatif

**Why it matters.** Today, even when the agent's answer is correct, the student walks away knowing how to do *that* problem. The thinking-frame card teaches them how to *recognise the genre next time*. **Recognition is what scales beyond a single tutoring session** — and it's what every great BAC teacher hammers on. This block is the direct UI surface for steps 2 and 3 of the Teacher Protocol (Part A.0).

**Effort:** ~2–3 days *after* the Pattern Atlas (Part E.1) covers the topic. Without the Atlas the card has no data to render.

### A12. *Dans la vraie vie* — the Tunisian real-life anchor chip ★ Teacher Protocol surface #2

**Tool call:** `emit_real_life_anchor({ short_anchor, full_explanation })`

**Student sees:** a one-sentence chip with a *Tell me more* expansion:

> 🌍 **Dans la vraie vie**
> Pense à l'aiguille des secondes d'une montre — une longueur (le module) et un angle (l'argument). z = 1 + i√3, c'est l'aiguille à 1h pile.

Tap → expanded paragraph with more grounded examples.

**Why it matters.** The single biggest *emotional* differentiator vs. ChatGPT. When the AI says "*pense au tarif du louage*" or "*comme la queue à la CCP*" in answer to a French math question, every Tunisian student reads it as "this thing was made **for me**". ChatGPT will never do this — it doesn't have the Analogy Library (Part E.3). This block is the direct UI surface for step 4 of the Teacher Protocol.

**Effort:** ~2 days for the renderer. The expensive part is curating the analogies themselves — see Part E.3.

### A13. *Ce que les correcteurs cherchent* — the marking-scheme card ★ Teacher Protocol surface #3

**Tool call:** `emit_marking_scheme({ steps: [{ step_idx, what_examiner_wants, points, common_loss_reasons: [...] }], total_points })`

**Student sees:** a per-step rubric card, usually rendered alongside the Stepwise Cards (A4) for a full solution:

> 📋 **Ce que les correcteurs cherchent**
> Étape 1 (modulus) — 0.5 pt formule + 0.5 pt valeur juste.
> Étape 2 (argument) — 1 pt total, **−0.25 si tu rates le signe**.
> Étape 3 (écriture finale) — 0.5 pt. Faut explicitement écrire `z = 2·e^{iπ/3}`, pas juste donner les deux valeurs séparément.

**Why it matters.** Tunisian BAC students are obsessive about *points* — correctly, since the BAC is a point game. Teaching them how points are awarded per step turns "I solved it" into "I solved it AND I know exactly where I'd score full marks vs. lose half-points". This is the strategic differentiator a great `prof particulier` provides; nothing else in the catalog does it.

**Effort:** ~3 days *after* the Pattern Atlas (Part E.1) is extended with per-step rubric data. Renderer reuses the same shell as A4 Stepwise Cards.

---

### A14. Free-Body / Circuit Diagram — `physique` matière coverage

**Tool call:** `emit_free_body_diagram({ bodies: [{id, label, position}], forces: [{from, to, label, magnitude_unit}], connections: [...] })` and `emit_circuit_diagram({...})`

**Student sees:** an SVG (or interactive matter.js for v2) showing the free-body diagram of a problem — masses, force vectors, friction surface, pendulum string. Or an electrical circuit with resistors, capacitors, voltage source.

**Why it matters.** `physique` is ~25% of student demand. None of A1–A10 fit it — they're all math-shaped. Without A14 the new render-block infrastructure shows nothing helpful for physique questions.

**Effort:** ~3–4 days for static SVG v1 (use a curated set of named element types — `mass`, `spring`, `pulley`, `incline`, `resistor`, `capacitor`, `voltage_source`). ~1.5 weeks for an interactive matter.js v2 where the student can drag a mass and watch the system swing. See Part F for the library pick.

### A15. Biological Process Diagram — `svt` matière coverage

**Tool call:** `emit_process_diagram({ stages: [{label, description, duration?}], cycle: bool })`

**Student sees:** a Mermaid `flowchart` or `stateDiagram` for processes like *mitose*, *photosynthèse*, *cycle cardiaque*. Mermaid is already installed (`@streamdown/mermaid`); this is a system-prompt change pointing the agent at it for svt content + a thin wrapper component to hint the diagram type.

**Why it matters.** Cheapest matière-coverage win. Mermaid is already wired up. The agent just needs few-shots + a tool call to know "use this for svt cycles".

**Effort:** ~2 days (mostly few-shots + prompt update).

### A16. Algorithm Trace Table — `algorithme` and `info` matière coverage

**Tool call:** `emit_trace_table({ headers: ["i", "j", "tab[i]", "tab[j]", "comment"], rows: [{values: [...], highlight_col?: int}] })`

**Student sees:** a structured table that walks through the values of each variable at each step of an algorithm, with the changed column highlighted at every row. Pair with `shiki`-highlighted pseudocode (already wired up via `@streamdown/code`).

**Why it matters.** The `algorithme` and `info` matières are non-trivial for the BAC and almost no AI tool does them well — they all just produce code without a trace. A trace table is the canonical pedagogical artefact for "*comment l'algo s'exécute pas à pas*". Cheap and uniquely valuable.

**Effort:** ~2 days. Table renderer + a system-prompt few-shot.

### A17. ER Diagram / Query-Result Card — `bd` matière coverage

**Tool call:** `emit_er_diagram({ entities: [...], relationships: [...] })` and `emit_query_result({ sql_or_algebra, result_table, narration })`

**Student sees:** a Mermaid `erDiagram` for the structural side, plus a clean rendered table for "what does this query return". The card is split into the schema, the query (with shiki highlighting), and the resulting rows.

**Why it matters.** `bd` (bases de données) is in the BAC for technique track. ER diagrams are the canonical artefact, and a clear "query → result" pairing is what students actually struggle to picture.

**Effort:** ~3 days.

---

## Part B — Chat thread types / modes

Distinct entry-points on `/new`. Each new chat is started in a chosen mode, persisted as `threads.mode` in DB. The mode determines:

- **System-prompt overlay** appended on top of the base tutor prompt.
- **Tool allow-list** (which `emit_*` tools the agent is allowed to call).
- **Chat-surface render** (e.g. Vibe Exam hides the chat input, Drill auto-advances cards).
- **Initial render** (Vibe Exam renders the paper immediately; Tuteur shows an empty input).

Threads can switch mode mid-conversation via a `Switch mode` action — the system prompt overlay swaps and the renderer changes. Useful for "we just understood Q3, now turn it into a 5-variant Drill".

### B1. Tuteur (default, current chat upgraded)

- **Goal:** explanation-first tutoring.
- **Default response shape:** Hint Ladder (A1) → Stepwise Solution Cards (A4) → Variant Generator suggestion (A6).
- **Tools allowed:** all output blocks; biased toward A1, A2, A4.
- **UI:** current chat, plus a sticky "Generate variants" CTA after solved questions.

### B2. Vibe Exam (the marquee, user's term)

- **Goal:** sit a full mock paper under exam conditions.
- **Open-prompt flow:** student picks topic(s) + difficulty + duration → agent emits Mock-Exam (A8) immediately on thread creation.
- **UI affordances:**
  - Timer pinned to top with countdown.
  - Chat input is **hidden**; the only action is `Submit attempt`.
  - Per-exercise scratchpad (handwriting + LaTeX) accumulates the student's answers.
  - On submit: agent grades using mark scheme + emits one Error-Diagnosis Card (A5) per mistake.
- **Tools allowed:** `emit_mock_exam`, `emit_error_diagnosis`. Hint Ladder is *disabled* during the timed phase, *enabled* after submit when the student reviews.
- **Why it matters:** the single most-asked-for feature in BAC-prep. Generic ChatGPT can fake it; Lemma can do it correctly because of the past-paper corpus + curriculum graph.

### B3. Drill

- **Goal:** 15-min variant blast on a chosen topic.
- **Flow:** student picks topic + duration → agent streams variants one at a time (A6, A7) with a per-card timer. First mistake → Hint Ladder (A1); second mistake → full step-through (A4).
- **UI:** card-stack interface (Tinder-style swipe), big timer, "stop drill" button.
- **Tools allowed:** `emit_variants`, `emit_hint_ladder`, `emit_solution_steps`.
- **Why it matters:** the most-used mode in practice — 15-min revision sessions on the bus, between classes.

### B4. Diagnose

- **Goal:** student already attempted, wants targeted feedback (NOT a full solution).
- **Flow:** student pastes their attempt → agent emits Error-Diagnosis Card (A5) + Hint Ladder (A1). Agent **refuses** to give the full solution unless the student explicitly asks twice.
- **System prompt:** "you are a strict diagnostic assistant; never volunteer a complete solution".
- **Tools allowed:** `emit_error_diagnosis`, `emit_hint_ladder`. `emit_solution_steps` requires explicit student request.
- **Why it matters:** tightest pedagogical loop. Pairs perfectly with Vibe Exam post-submit review.

### B5. Explore

- **Goal:** Neo4j-driven concept walk; no problems, just structure.
- **Flow:** student picks a topic → agent emits Concept-Map Slice (A3) → student taps a node → agent narrates what that topic is, why it connects, and what's worth knowing.
- **UI:** the concept map is the *primary* render, chat is secondary commentary.
- **Tools allowed:** `emit_concept_map`. No exercises.
- **Why it matters:** turns the curriculum graph from a backend asset into a student-facing playground.

### B6. Build

- **Goal:** generate practice exercises (not solve them).
- **Flow:** student picks topic + difficulty + count → agent emits Variant Generator (A6) + Difficulty Ladder (A7) + Cross-Topic Problem (A9) + Reverse Problem (A10) as appropriate.
- **UI:** exercises are the output, with `Solve` and `Save to deck` actions.
- **Tools allowed:** all "build" tools; explanation tools disabled (use Tuteur for that).

### Architectural rule (do NOT violate)

**One agent, one tool catalog, one LangGraph.** Modes are configurations, not separate agents. Forking the agent into six personas would force you to maintain six system prompts whose quality would diverge. Implement modes as:

- A `mode: "tuteur" | "vibe_exam" | "drill" | "diagnose" | "explore" | "build"` column on `threads`.
- A `MODE_OVERLAYS: Record<Mode, { system_prompt_suffix, tool_allowlist, default_render }>` config on the backend.
- A `<ChatSurface mode={thread.mode}>` switch on the frontend that picks the renderer.

Switching mode mid-thread is just `UPDATE threads SET mode = ? WHERE id = ?` + a frontend re-render.

---

## Part C — Tier-S "wow" features (longer horizon)

Bigger lifts. Build *after* A + B are stable. Each of these compounds on the existing renderable-tool-call infrastructure.

### C1. Snap-a-Question → Interactive Solution Cards

Student takes a photo of a problem from their textbook / worksheet / past paper. The agent OCRs the LaTeX and renders the solution as a stack of Stepwise Cards (A4) where every KaTeX symbol is a button — tap a `+` to flip it to `−` and watch the consequence.

- **OCR:** NIM math-OCR for paid tier; `pix2tex` (open weights) for free tier.
- **Manipulable KaTeX:** render KaTeX into a custom React tree, replace each `<span class="mord">` with a `<button>` that opens an inline picker.
- **Effort:** ~2–3 weeks credible prototype, ~6–8 weeks polished.
- **Differentiator:** "Khan Academy lets you watch. ChatGPT lets you read. Lemma lets you *touch* the math."

### C2. Inline Live Function Lab (Desmos but agent-driven)

When the agent talks about any function `f(x)`, an inline plot materialises (`mafs.js` / `@mafs/core`) with sliders for free parameters. Drag a slider → curve animates → agent annotates the plot in real-time ("see the inflection point move as `a` crosses zero").

- **Tool call:** `render_plot({ expr, range, interactiveParams: ['a'], annotations: [...] })`.
- **Agent reactivity:** tool `update_plot_annotation(plotId, annotation)` emits when the student drags.
- **Effort:** ~1.5–2 weeks.

### C3. Whiteboard-Mode Explainer Video, generated on demand

A `Show me on the whiteboard` button on every long answer. Tap → full-screen dark whiteboard, equations animated stroke-by-stroke (3Blue1Brown aesthetic), arrows + circles drawn around important parts, narrated by NIM TTS in French (Arabic for explanation, French for math). Standard video controls.

- **Render:** **`manim-web`** — a TypeScript port of 3Blue1Brown's Manim that runs entirely in the browser via WebGL/Three.js, with KaTeX integration and a first-class React component. The agent emits a small `manim_scene` DSL (`{steps: [{op: "write", latex: "..."}, {op: "transform", from: "...", to: "..."}, {op: "fade_in", obj_id: "..."}]}`) and a React component plays it. **This obsoletes the earlier plan** that suggested a custom `<canvas>` with stroke-by-stroke KaTeX replay (see also Part F.5).
- **TTS:** NIM Riva or ElevenLabs Multilingual.
- **Sync:** each step in the scene DSL has a `narration_cue_idx`; the manim-web Scene advances when the audio crosses the cue.
- **Server-side render to MP4 (later):** if shareable .mp4 becomes a growth lever (TikTok / WhatsApp), Remotion is the only React-native option for headless rendering. Pairs naturally with manim-web.
- **Effort:** ~2 weeks for v1 (was ~3–4 weeks under the old canvas-replay plan). manim-web removes 60% of the work.
- **Differentiator:** every answer is a 3Blue1Brown-style video, made just for you, in seconds. Irresistible classroom-level shareable.

### C4. Solve-with-Me handwriting mode

Student writes the next derivation step on the screen (finger / stylus / paper photo); agent OCRs the handwriting, validates, gives targeted feedback. Reuses the C1 OCR pipeline.

- **Effort:** ~1.5 weeks if C1 is already built.

---

## Part D — Display recommendations (cross-cutting)

These apply to every renderable block above:

1. **Mobile-first physical constraints.** Tunisian BAC students study on their phones more than at a desk.
   - Math containers must `overflow-x-auto` with a faint right-edge fade and a "swipe →" affordance the first time the student encounters it. Long display equations should never silently truncate.
   - Tap targets ≥ 44×44 px (Hint Ladder pills, Stepwise Card toggles, Generate variants buttons).
   - Body text on chat surfaces ≥ 16 px.
   - Persistent sticky `Back to question` button when the student scrolls deep into a derivation.

2. **Coloured semantic chips.** `[BAC 2022]`, `[Foundation]`, `[Standard]`, `[Advanced]`, `[Common error]`, `[Memorise]`, `[Derive]`. Same vocabulary across all blocks.

3. **Honest uncertainty surface.** When the agent is uncertain (low confidence, conflicting sources, non-standard convention), say so visibly with a yellow callout — don't bury it in prose. Students treat AI output as authoritative; that's dangerous in maths.

4. **Citation chips.** When paraphrasing the official curriculum, render a chip linking to the source ("Programme officiel — Section 1.3 ↗"). Builds trust + anchors the student in the canonical reference.

5. **Voice / TTS on every display equation.** A `🔊` icon next to display math; tap to hear the equation read aloud (KaTeX exposes MathML → Web Speech API or NIM Riva). Big accessibility win, big audio-learner win.

6. **Stepwise reveal as default.** Hide the working behind a "Show step" toggle; force the student to attempt first. The agent's full solution should rarely be the *immediate* response.

7. **Two languages, intentionally.** The agent should speak French for math content (`forme exponentielle`, `module`, `argument`, `dérivée`) — that's what the BAC will mark — but Tunisian Arabic / darija for explanation tone (`khalliik f'l module luwwel`, `t'aki tnseiha`). Strictly one direction: never French explanations of an Arabic math term. The Analogy Library (Part E.3) decides which language each anchor lands in.

---

## Part E — The three content assets (the actual moat)

The Teacher Protocol (Part A.0) and the new render blocks A11 / A12 / A13 all depend on three structured **knowledge assets**. These are not code; they are curated, hand-edited datasets specific to the Tunisian BAC programme. They are the actual moat — competitors can clone the UI, but they cannot easily clone these.

### E.1. Pattern Atlas

**Shape (one record per topic):**

```jsonc
{
  "topic_id": "complex-numbers/exponential-form",
  "topic_label_fr": "Forme exponentielle",
  "topic_label_ar": "الشكل الأسي",
  "frequency_in_bac": 0.95,            // 1.0 = appears every year
  "canonical_recipe": [
    "Calculer le module r = √(a² + b²).",
    "Calculer l'argument θ = arctan(b/a) (corrigé selon le quadrant).",
    "Écrire z = r · e^{iθ}."
  ],
  "typical_exam_framings": [
    "Donne la forme exponentielle de z = a + bi.",
    "Soit z₁ et z₂ deux complexes ; calcule (z₁/z₂)^n via la forme exponentielle.",
    "Démontre que e^{iπ/3} est solution d'une équation polynomiale."
  ],
  "variations": [
    { "label": "négatif imaginaire", "example": "z = 1 - i√3", "delta": "argument signe" },
    { "label": "module non-trivial", "example": "z = √3 + i", "delta": "rationalisation du module" }
  ],
  "per_step_rubric": [
    { "step_idx": 1, "what_examiner_wants": "formule + valeur correcte du module", "points": 1.0,
      "common_loss_reasons": ["calcul de module sans la racine carrée"] },
    { "step_idx": 2, "what_examiner_wants": "argument avec le bon signe et bon quadrant", "points": 1.0,
      "common_loss_reasons": ["arctan sans correction de quadrant", "signe inversé"] },
    { "step_idx": 3, "what_examiner_wants": "écriture explicite z = r · e^{iθ}", "points": 0.5,
      "common_loss_reasons": ["donne r et θ séparément sans la combinaison"] }
  ]
}
```

**How to seed it:**
- Start from the existing Qdrant past-paper corpus. Cluster questions by topic. For each cluster, ask GPT-5 (or NIM equivalent) to extract the canonical recipe + 3 typical framings. **Then have a Tunisian `prof particulier` review and correct the result.** The teacher review is non-optional — without it, the recipes drift toward "generic French textbook math" and lose the Tunisian-BAC specificity that's the whole point.
- Store as JSON in Neo4j as `(:Topic {topic_id}) -[:HAS_PATTERN]-> (:Pattern)` so the curriculum graph stays the source of truth. `recall_recipe` is a single Neo4j query.

**Coverage target:** 80 topics across the 9 matières, prioritised by `frequency_in_bac`. Cover the top-20 first; that gets ~60% of student questions.

**Why it matters.** Powers steps 2 and 3 of the Teacher Protocol (RECALL THE RECIPE / RECALL THE TRAP) and the A11 / A13 renderers.

**Effort:** ~2 weeks (1 week for the mining + extraction pipeline, 1 week of teacher review for the top 20 topics).

### E.2. Mistake Corpus

**Shape:**

```jsonc
{
  "topic_id": "complex-numbers/exponential-form",
  "mistakes": [
    {
      "id": "argument_sign_flip",
      "frequency": 0.42,                // ~42% of students who get the question wrong make THIS mistake
      "wrong_pattern": "z = 1 - i√3 → arg = π/3",
      "diagnostic": "L'imaginaire est négatif → on est dans le 4e quadrant → l'argument doit être négatif (-π/3, pas +π/3).",
      "correction_hint": "Rappelle-toi : l'argument se lit comme un angle sur le cercle trigo. Si Im(z) < 0, on est en bas, donc θ < 0.",
      "tunisian_meme": "Comme quand tu confonds Bab Souika et Bab Jedid — c'est juste un flip d'un côté."
    },
    {
      "id": "modulus_no_square_root",
      "frequency": 0.18,
      "wrong_pattern": "|1 + i√3| = 1 + 3 = 4",
      "diagnostic": "Le module est √(a² + b²), pas a² + b². Les correcteurs déduisent souvent 1 point complet pour ça.",
      "correction_hint": "Module = distance à l'origine, donc sqrt(...) toujours."
    }
  ]
}
```

**How to seed it:**
- Mine the existing `corrigés` of past papers — their *commentaires correcteurs* sections sometimes flag common mistakes.
- Augment with synthetic generation: prompt the agent with a problem and a buggy student answer and have it classify the mistake against a known taxonomy.
- **Teacher review is again non-optional** — synthetic mistakes drift toward "stuff a French math student might do" rather than "stuff a Tunisian BAC student actually does".

**Why it matters.** Powers step 3 of the Teacher Protocol and is the data behind A5 Error-Diagnosis Card. Also unlocks Drill mode's "common-mistake variant" generation.

**Effort:** ~2 weeks for the top-20 topics.

### E.3. Analogy Library

**Shape:**

```jsonc
{
  "concept_id": "linear-function",
  "anchors": [
    {
      "label": "Le tarif du louage Bab Saadoun → Hammamet",
      "language": "fr-tn",
      "short": "Le prix du louage est une fonction affine du nombre de places réservées : prix = 5 dt × n + 2 dt de frais fixes.",
      "full": "Quand tu prends un louage, tu paies 5 dinars par siège (le coefficient directeur a) plus une commission fixe de 2 dinars (l'ordonnée à l'origine b). Le prix total y = a×x + b — c'est exactement la définition d'une fonction affine.",
      "tags": ["transport", "money"]
    }
  ]
}
```

**Examples already in the proposal pool:**

| Concept | Anchor |
|---|---|
| Affine function | Le tarif du louage : prix = a·places + commission fixe. |
| Geometric sequence | L'intérêt composé sur ton compte CCP. |
| Exponential form | L'aiguille des secondes — un module et un angle. |
| Limit | Marcher vers Hammamet en pas qui se divisent par 2 — tu approches sans jamais y arriver. |
| Cinematique (uniform motion) | Le M5 vers La Marsa : x(t) = position de départ + vitesse · t. |
| Kirchhoff's first law | Les voitures qui entrent au rond-point d'Africa = les voitures qui en sortent. |
| Mitose | Comme la pâte de mlewi qu'on plie en deux : une cellule → deux cellules identiques. |
| Cycle cardiaque | Comme la pompe à eau du puits — diastole = remplissage, systole = poussée. |
| Algorithme glouton | Comme prendre les pièces de monnaie pour payer 17 millimes — toujours la plus grosse d'abord. |

**How to seed it:**
- Start with ~50 anchors covering the most frequent BAC concepts.
- Crowdsource extension via internal tooling — add an internal `/admin/anchors` page where the team (and trusted teachers) can submit + vote on anchors. Cheap to build, scales without engineering bottleneck.

**Why it matters.** The single biggest *emotional* differentiator vs. ChatGPT. Powers step 4 of the Teacher Protocol and the A12 *Dans la vraie vie* renderer.

**Effort:** ~1 week for the initial 50 anchors. Ongoing curation forever.

### Architectural placement of all three

- All three live in **Postgres** (or Neo4j for the Atlas, since it's already topic-graph-shaped). Static JSON is fine for v1 of the Analogy Library.
- All three are exposed as new tool calls (`recall_recipe`, `recall_typical_mistake`, `recall_analogy`) the agent calls during the Teacher Protocol.
- All three are **versioned** — when a teacher reviewer edits an anchor or recipe, that's tracked so we can A/B which version produces better student outcomes.

---

## Part F — Library shortlist for new render surfaces

Concrete picks for the libraries that power the new render blocks. All are MIT or free-for-education unless noted. **None require leaving the existing Next.js + React 19 + Streamdown stack.**

### F.1. Math plotting + interactive geometry

| Library | When to use | Why |
|---|---|---|
| **`mafs`** | Default for inline plots, `2D` math objects, concept maps. | Khan Academy uses this. Declarative React API; perfectly fits the existing AI-elements pattern. MIT. Best primary pick. |
| **Desmos API** | Live Function Lab (C2). | The best function plotter on the web. Free for educational use. |
| **`JSXGraph`** | Geometry-specific things `mafs` doesn't do well: angle bisectors, conics, the complex plane. | MIT. Ugly default styling but unmatched on geometry. |
| **`function-plot`** | Quick static plots with no interactivity. Already lightweight. | MIT. Good fallback if `mafs` proves too heavy. |

### F.2. Math input

| Library | When to use | Why |
|---|---|---|
| **`MathLive` `<math-field>`** | Anywhere the student needs to TYPE math (A4 predict-next, A10 reverse-problem, exam mode). | The only mature web math input editor with mobile virtual keyboard. MIT. **Currently missing from the stack — adding this unblocks ~3 of the Phase-1 blocks.** See Part G. |

### F.3. Sketch / whiteboard / hand-drawn diagrams

| Library | When to use | Why |
|---|---|---|
| **`Excalidraw`** | The "show your work" pad for the student (Part G). Plus agent-emitted hand-drawn-style diagrams (svt cycles, physique schemas). | MIT. The hand-drawn aesthetic is psychologically right for a tutor — feels less authoritative, less "AI", more "we're working it out together". |
| **`tldraw`** | Alternative to Excalidraw. Better React API, cleaner extensibility. | Apache 2.0. |

### F.4. Programmatic videos

| Library | When to use | Why |
|---|---|---|
| **`manim-web`** | C3 Whiteboard-Mode Explainer Video. | TypeScript port of 3Blue1Brown's Manim. Runs in-browser via WebGL. Has KaTeX support and a React component. **Replaces the earlier custom canvas + stroke-replay plan and saves ~2 weeks of effort.** |
| **`Remotion`** | If/when shareable .mp4 videos become a growth lever (TikTok / WhatsApp). | The only React-native option for headless server-side video rendering. Pairs naturally with manim-web. |

### F.5. Physics / 3D

| Library | When to use | Why |
|---|---|---|
| **`matter.js`** | A14 Free-Body Diagram v2 (interactive — drag the mass, watch it swing). | Mature 2D physics. MIT. |
| **`react-three-fiber` + `@react-three/rapier`** | Ambitious physique sims (3D inclined planes, oscillators, projectile motion in 3D). | MIT. Probably overkill for v1; flag for later. |

### F.6. Knowledge graph

| Library | When to use | Why |
|---|---|---|
| **`react-flow`** | A3 Concept-Map Slice (current default). | MIT. Already a natural fit. |
| **`Cytoscape.js`** | Alternative if the slice grows past ~30 nodes and needs cluster layouts. | MIT. More performant on dense graphs. |

### F.7. Misc that earn their keep

| Library | When to use | Why |
|---|---|---|
| **`react-pdf-kit`** | Embed the past-paper PDF inline inside A2 chip "view full page" expansion. | MIT. Avoids opening external windows. |
| **`react-rewards`** | Drill mode (B3) confetti / coin-shower micro-rewards. | 3.6 KB, MIT. |
| **`@streamdown/code` (`shiki`)** | Already installed. The renderer for A16 algorithm trace tables and the `algorithme` / `info` matières. | Use it. |
| **`@streamdown/mermaid`** | Already installed. The renderer for A15 biological process diagrams and A17 ER diagrams. | Use it. |
| **`motion` (Framer Motion)** | Already installed. Stepwise Card reveals, Hint Ladder rung animations. | Use it. |
| **`recharts`** | Already installed. Progress dashboards (Phase 5+). | Use it. |

### What NOT to introduce

- A new state management library (zustand/jotai/...). React 19 + Tanstack Query is enough.
- A new component library (Chakra/shadcn-Pro/...). The current Streamdown + Tailwind 4 layer is sufficient.
- A new model provider abstraction. `MODEL_PROVIDER` already exists; don't duplicate.

---

## Part G — The "Show-your-work pad" (structured input modality)

A surface that's missing from the original vision and that **half of Part A silently depends on**.

**Problem.** Today the agent only receives text from the student. That makes A4 (predict-next-step), A5 (Error-Diagnosis Card), A10 (Reverse Problem) much weaker than they could be — Tunisian BAC students don't write LaTeX, they scribble on paper. If the only way to "show your working" is to type unicode pseudo-math into a chat input, most students just won't.

**The pad.** A dedicated input surface, opened from a `+` button in the chat input bar (or auto-opened in Diagnose mode), that combines three input affordances:

1. **`<math-field>` (MathLive)** — for typed equations, with a mobile virtual keyboard. Output is LaTeX the agent can read directly.
2. **Excalidraw / tldraw sketch surface** — for free-form drawing (geometry diagrams, free-body diagrams, scratch arithmetic). Output is a vector representation the agent can OCR / interpret.
3. **Inline annotation on the existing answer** — student can highlight a step in the agent's previous answer and write "*ici je suis perdu*" or "*pourquoi sqrt et pas square*". The agent receives a structured `{anchor: step_idx, comment, snippet_quoted}` payload.

**Why this is core, not tier-S.** Without the pad:
- A4 *Predict the next step* requires typing LaTeX, which students won't do.
- A5 Error-Diagnosis Card has nothing to diagnose because the student hasn't shown working.
- Diagnose mode (B4) asks "*qu'est-ce que t'as essayé*" and the student can't realistically answer in text.
- Vibe Exam (B2) cannot accept hand-shown working, which the BAC actually requires.

**Effort:** ~1.5 weeks for v1 (math-field + Excalidraw, no annotation). +1 week for inline annotation. **Belongs in Phase 2.5 — between modes infrastructure and Vibe Exam — not in tier-S.**

---

## Build order (recommended)

Eight phases, each shipping value the day it lands. **Total to a fully differentiated product: ~9–10 weeks of focused work.** (The earlier 6–7-week estimate was honest about the engineering but skipped the content-asset seeding, the grading layer, the matière coverage gaps, and the input-modality work — see `lemma-vision-review.md` for the full deltas.)

A key sequencing change vs. the original draft: **the three content assets (Part E) are seeded *during* Phase 1 — in parallel with the engineering, not after it.** Without the Atlas / Corpus / Library, the new render blocks A11 / A12 / A13 have no data to render and the Teacher Protocol (Part A.0) degrades to ChatGPT-with-extra-steps.

### Phase 1 — foundations + content-asset seeding (~2.5 weeks, two parallel tracks)

**Engineering track (~2 weeks):**

| # | Block | Why first | Effort |
|---|---|---|---|
| 1 | A2 Past-Paper Context Chip | Cheap; immediate trust signal; pure Qdrant. | 2 d |
| 2 | A1 Hint Ladder (soft-gate version) | Highest pedagogical ROI of all. | 3–4 d |
| 3 | A6 Variant Generator | Most-asked-for student behaviour. | 3 d |
| 4 | A4 Stepwise Solution Cards | Replaces wall-of-LaTeX response shape. | 4–5 d |

**Content track (~2.5 weeks, runs in parallel):**

- Pattern Atlas — top-20 BAC topics by frequency. Mining pipeline + teacher review (Part E.1). ~2 weeks.
- Mistake Corpus — top-20 topics. Mine `corrigés` + teacher annotation (Part E.2). ~2 weeks.
- Analogy Library — 50 anchors across matières (Part E.3). ~1 week.

After Phase 1 the existing chat (B1 Tuteur) is dramatically better, **and the data is in place to light up the Teacher Protocol the moment Phase 1.5 ships.** Establishes the renderable-tool-call pattern + frontend renderer plumbing for everything later.

### Phase 1.5 — wire up the Teacher Protocol (~1 week)

This is the inflection point where Lemma stops feeling like a smarter ChatGPT and starts feeling like a teacher.

- Add `recall_recipe`, `recall_typical_mistake`, `recall_analogy` tool calls on the agent (~2 d).
- Add the protocol suffix to the base system prompt + few-shots (~2 d).
- Ship A11 *Comment penser à ça* renderer + agent emit (~2 d).
- Ship A12 *Dans la vraie vie* renderer + agent emit (~1 d).
- Ship A13 *Ce que les correcteurs cherchent* renderer + agent emit (~2 d).

### Phase 2 — modes infrastructure (~1 week)

- Add `threads.mode` column + migration.
- Add `MODE_OVERLAYS` config (system-prompt suffix, tool allow-list, default render). The base Teacher Protocol is shared; per-mode overlays add further constraints (e.g. Diagnose hard-locks Hint Ladder rung 4; Vibe Exam suppresses A12 mid-exam).
- Add `<ChatSurface mode={thread.mode}>` frontend switch.
- Add `/new` launchpad with mode cards (initially: Tuteur + one new mode).
- Add `Switch mode` action on existing threads.

### Phase 2.5 — Show-your-work pad (input modality) (~1.5 weeks)

See Part G. Adds MathLive + Excalidraw as a structured input. **Belongs before Phase 3** because Vibe Exam grading and Diagnose mode both rely on the student showing working that the agent can read.

### Phase 3 — first dedicated mode: Vibe Exam (~3.5 weeks, was 2)

Includes A8 Mock-Exam Generator + A5 Error-Diagnosis Card + the Vibe Exam UI (timer, hidden input, submit, grading). Marquee home-page feature.

The +1.5 weeks vs. the original estimate is the **structured grading layer** (per-step mark-scheme schema + separate grading-agent run + human calibration loop on the first 50 papers). See A8 for the honest scope.

### Phase 4 — Drill + Diagnose (~2 weeks)

- B3 Drill (~1 week): card-stack interface, per-card timer, mistake-triggered Hint Ladder. Pulls common-mistake variants directly from the Mistake Corpus (Part E.2).
- B4 Diagnose (~5 d): system-prompt overlay enforcing "no full solutions"; reuses A5 + A1; Hint Ladder rung 4 is hard-locked here.

### Phase 5 — Explore + Build (~2 weeks)

- B5 Explore (~1 week): A3 Concept-Map Slice as primary render, Neo4j-driven.
- B6 Build (~5 d): A7 Difficulty Ladder + A9 Cross-Topic + A10 Reverse Problem.

### Phase 6 — non-math matière coverage (~2 weeks)

- A14 Free-Body / Circuit Diagram — `physique`. ~3–4 d for static SVG v1.
- A15 Biological Process Diagram — `svt`. ~2 d (Mermaid wired up).
- A16 Algorithm Trace Table — `algorithme` / `info`. ~2 d.
- A17 ER Diagram / Query Result — `bd`. ~3 d.
- Extend Pattern Atlas / Mistake Corpus to cover top-20 topics in physique, svt, algorithme, bd. **This is the gating constraint** — the renderers ship in days; the content takes ~1 week each per matière.

The earlier draft was implicitly math-centric. With ~25% of demand coming from physique alone, this phase is non-optional for a real BAC-prep product.

### Phase 7 (later, optional) — tier-S wow

C1 Snap-a-Question → C4 Solve-with-Me → C2 Live Function Lab → C3 Whiteboard Videos (now using **manim-web**, ~2 weeks instead of ~3–4). Each is a 2–4-week lift; sequence them based on user telemetry from Phases 1–6.

---

## How to use this file in a future Devin session

If the user picks up the conversation with "let's build the Vibe Exam" / "implement the Hint Ladder" / "add a new chat mode", you can:

1. **Skip the back-and-forth.** All the design decisions (single agent, mode overlays, renderable tool calls, Teacher Protocol, content assets, etc.) are settled here. Just ask which specific block to build first if the user is ambiguous.
2. **The Teacher Protocol is non-optional.** When implementing any block that responds to a problem-shaped student message, the system prompt MUST instruct the agent to run the 7-step protocol from Part A.0 and to call `recall_recipe` / `recall_typical_mistake` / `recall_analogy` before composing. If those tool calls don't exist yet, stub them returning `{covered: false}` — but do not skip the protocol shape itself.
3. **Match the architecture.** Every new mode = `threads.mode` + `MODE_OVERLAYS` entry + `<ChatSurface mode>` branch. Every new block = `tool-*` part type + frontend renderer + system-prompt few-shots. Don't invent a new pattern.
4. **Don't ship a teacher-output block without its content asset.** A11 *Comment penser à ça* without the Pattern Atlas, A12 *Dans la vraie vie* without the Analogy Library, and A13 *Ce que les correcteurs cherchent* without per-step rubrics will all degrade gracefully but feel hollow. Seed the asset (Part E) for at least the topics you're targeting before turning the renderer on.
5. **Keep `<ref_file>` paths consistent.** Renderers live next to existing AI-elements components: `frontend/components/ai-elements/`. Mode-specific surfaces live in `frontend/components/chat/modes/<mode>/`. Content assets live in `backend/src/content/{atlas,mistakes,analogies}/` (or in Neo4j for the Atlas).
6. **Library picks are settled in Part F.** Don't re-research math plotting / sketch / video libraries every time. If a new use-case genuinely doesn't fit any of the picks in Part F, update Part F as part of the PR.
7. **Cross-reference**:
   - `.agents/skills/chat-streaming/SKILL.md` — streaming + RunStreamHub + KaTeX CSS gotcha + docker-compose smoke-test recipe.
   - `.agents/skills/frontend-landing/SKILL.md` — frontend dev server, env files, peer-deps notes.

---

## What is explicitly OUT of scope (don't suggest these)

- **Replacing Streamdown / KaTeX / Mermaid.** They work. The KaTeX CSS gotcha (PR #32) is fixed; don't reopen.
- **Forking the agent into multiple persona agents.** Modes are configurations, not separate agents (see Architectural rule). The grading layer in Vibe Exam is a different *node* in the same LangGraph, not a different agent.
- **Building a custom whiteboard renderer for C3.** `manim-web` exists. Don't reimplement canvas + stroke-by-stroke KaTeX replay (the earlier draft of this doc proposed that; it's now superseded — see Part F.4).
- **Rewriting `RunStreamHub` or the resume-on-reload contract.** PR #31 fixed the reload-aborts-stream bug; the architecture is intentionally decoupled.
- **Adding a new database/vector store.** Neo4j (curriculum + Pattern Atlas) + Qdrant (past papers) cover the design needs of every block above. The Mistake Corpus and Analogy Library can live in Postgres or static JSON; they don't need a new store.
- **Replacing NVIDIA NIM with another model provider.** The `MODEL_PROVIDER` abstraction exists if needed, but model choice is a separate axis.
- **Building "study buddy" / community / leaderboard / chat-with-other-students features.** Out of scope for this product; Lemma is a 1:1 tutor, not a forum.
- **Generating questions from scratch without grounding in the past-paper corpus.** Always condition on Qdrant — drift away from the actual BAC style is a death-by-a-thousand-cuts UX failure.

---

## Status / changelog

- 2026-05-07: initial vision doc, captured during the same session as the math-rendering fix (PR #32). Authored after a brainstorm with the user where they asked: (1) "what can the agent output beyond text", (2) "different chat types like vibe exam — what do you think", and (3) explicitly requested this be persisted to the repo so the next session picks up where we left off.
- 2026-05-07 (revision 2): substantially expanded after the user pushed back with two questions: (i) *"what other libraries can help simulate / illustrate"* — produced the library shortlist now in Part F + the C3 manim-web swap; (ii) *"how does the agent really become a **teacher**, not just a smarter UI?"* — produced the Teacher Protocol (Part A.0), the three content assets (Part E), and the three teacher-output render blocks (A11 / A12 / A13). Other changes in this revision:
  - Soft-gate refinement on A1 (rung 4 is no longer hard-locked outside Diagnose mode).
  - Honest scope on A8 grading (structured rubric schema + separate grading-agent run + human calibration; +1.5 weeks).
  - Added A14 (Free-Body / Circuit), A15 (Process), A16 (Trace Table), A17 (ER) to cover physique / svt / algorithme / bd matières — the original draft was math-centric.
  - Added Part G "Show-your-work pad" as core infrastructure (was implicitly missing; ~half of Part A silently depended on it).
  - Build order moved from 5 phases / 6–7 weeks to 8 phases / ~9–10 weeks; content assets are now seeded *during* Phase 1 in parallel with engineering, not after.
  - Updated "How to use this file" to require the Teacher Protocol on every problem-shaped turn.
  - Source analysis docs that fed this revision: `lemma-vision-review.md` (library shortlist + 5 pushbacks) and `lemma-teacher-protocol.md` (the protocol + content assets + B11/B12/B13 — now A11/A12/A13 in this file).
