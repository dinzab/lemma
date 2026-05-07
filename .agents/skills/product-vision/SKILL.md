---
name: product-vision
description: Lemma's product roadmap for moving the BacPrep AI tutor beyond a markdown-only chat — concrete agent output types (Hint Ladder, Past-Paper Chip, Concept Map, Stepwise Cards, Variant Generator, Mock Exam, etc.), dedicated chat thread types ("Tuteur", "Vibe Exam", "Drill", "Diagnose", "Explore", "Build"), and tier-S "wow" ideas. Future sessions should treat this as the source of truth for product direction without needing the user to re-explain.
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

**Effort:** ~2 weeks for v1, ~4 weeks polished. This is the natural backbone of the *Vibe Exam* mode (Part B, B2).

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

A `Show me on the whiteboard` button on every long answer. Tap → full-screen dark whiteboard, equations written stroke-by-stroke (handwritten font), arrows + circles drawn around important parts, narrated by NIM TTS in French (Arabic for explanation, French for math). Standard video controls.

- **Render:** `<canvas>` with stroke-by-stroke replay of pre-tokenised KaTeX (look at `Manim Slides`, `MotionCanvas`, `Fabric.js`).
- **TTS:** NIM Riva or ElevenLabs Multilingual.
- **Sync:** each KaTeX node has a `data-narration-cue` index; the canvas advances when the audio crosses the cue.
- **Effort:** ~3–4 weeks for v1 (display math only).
- **Differentiator:** every answer is a video, made just for you, in seconds. Irresistible classroom-level shareable.

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

---

## Build order (recommended)

Five phases, each shipping value the day it lands. Total to a fully differentiated product: ~6–7 weeks of focused work.

### Phase 1 — foundations (~2 weeks)

| # | Block | Why first | Effort |
|---|---|---|---|
| 1 | A2 Past-Paper Context Chip | Cheap; immediate trust signal; pure Qdrant. | 2 d |
| 2 | A1 Hint Ladder | Highest pedagogical ROI of all. | 3–4 d |
| 3 | A6 Variant Generator | Most-asked-for student behaviour. | 3 d |
| 4 | A4 Stepwise Solution Cards | Replaces wall-of-LaTeX response shape. | 4–5 d |

After Phase 1, the existing chat (B1 Tuteur) is dramatically better with no new modes added yet. Establishes the renderable-tool-call pattern + frontend renderer plumbing for everything later.

### Phase 2 — modes infrastructure (~1 week)

- Add `threads.mode` column + migration.
- Add `MODE_OVERLAYS` config (system-prompt suffix, tool allow-list, default render).
- Add `<ChatSurface mode={thread.mode}>` frontend switch.
- Add `/new` launchpad with mode cards (initially: Tuteur + one new mode).
- Add `Switch mode` action on existing threads.

### Phase 3 — first dedicated mode: Vibe Exam (~2 weeks)

Includes A8 Mock-Exam Generator + A5 Error-Diagnosis Card + the Vibe Exam UI (timer, hidden input, submit, grading). Marquee home-page feature.

### Phase 4 — Drill + Diagnose (~2 weeks)

- B3 Drill (~1 week): card-stack interface, per-card timer, mistake-triggered Hint Ladder.
- B4 Diagnose (~5 d): system-prompt overlay enforcing "no full solutions"; reuses A5 + A1.

### Phase 5 — Explore + Build (~2 weeks)

- B5 Explore (~1 week): A3 Concept-Map Slice as primary render, Neo4j-driven.
- B6 Build (~5 d): A7 Difficulty Ladder + A9 Cross-Topic + A10 Reverse Problem.

### Phase 6 (later, optional) — tier-S wow

C1 Snap-a-Question → C4 Solve-with-Me → C2 Live Function Lab → C3 Whiteboard Videos. Each is a 2–4-week lift; sequence them based on user telemetry from Phases 1–5.

---

## How to use this file in a future Devin session

If the user picks up the conversation with "let's build the Vibe Exam" / "implement the Hint Ladder" / "add a new chat mode", you can:

1. **Skip the back-and-forth.** All the design decisions (single agent, mode overlays, renderable tool calls, etc.) are settled here. Just ask which specific block to build first if the user is ambiguous.
2. **Match the architecture.** Every new mode = `threads.mode` + `MODE_OVERLAYS` entry + `<ChatSurface mode>` branch. Every new block = `tool-*` part type + frontend renderer + system-prompt few-shots. Don't invent a new pattern.
3. **Keep `<ref_file>` paths consistent.** Renderers live next to existing AI-elements components: `frontend/components/ai-elements/`. Mode-specific surfaces live in `frontend/components/chat/modes/<mode>/`.
4. **Cross-reference**:
   - `.agents/skills/chat-streaming/SKILL.md` — streaming + RunStreamHub + KaTeX CSS gotcha + docker-compose smoke-test recipe.
   - `.agents/skills/frontend-landing/SKILL.md` — frontend dev server, env files, peer-deps notes.

---

## What is explicitly OUT of scope (don't suggest these)

- **Replacing Streamdown / KaTeX / Mermaid.** They work. The KaTeX CSS gotcha (PR #32) is fixed; don't reopen.
- **Forking the agent into multiple persona agents.** Modes are configurations, not separate agents (see Architectural rule).
- **Rewriting `RunStreamHub` or the resume-on-reload contract.** PR #31 fixed the reload-aborts-stream bug; the architecture is intentionally decoupled.
- **Adding a new database/vector store.** Neo4j (curriculum) + Qdrant (past papers) cover the design needs of every block above.
- **Replacing NVIDIA NIM with another model provider.** The `MODEL_PROVIDER` abstraction exists if needed, but model choice is a separate axis.

---

## Status / changelog

- 2026-05-07: initial vision doc, captured during the same session as the math-rendering fix (PR #32). Authored after a brainstorm with the user where they asked: (1) "what can the agent output beyond text", (2) "different chat types like vibe exam — what do you think", and (3) explicitly requested this be persisted to the repo so the next session picks up where we left off.
