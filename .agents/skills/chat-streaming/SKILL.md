---
name: chat-streaming
description: Reference knowledge for working on Lemma's chat surface — the streaming architecture (RunStreamHub, resume-on-reload), the Streamdown markdown/math/code pipeline (and the KaTeX CSS gotcha), and how to set up + smoke-test the running app end-to-end.
---

# Lemma — Chat streaming, rendering, and end-to-end testing

Reference knowledge for any task that touches `backend/src/chat/*`, `backend/src/agent-runs/*`, `frontend/components/ai-elements/message.tsx`, or `frontend/components/chat/LemmaConversation.tsx`.

## Streaming architecture (the bit that bites)

The agent run lifecycle is **decoupled** from the HTTP response lifecycle. Don't accidentally re-couple them.

- `POST /chat/stream` calls `ChatService.streamRunToResponse`, which:
  1. Inserts the user message,
  2. Kicks off the agent loop in the background as `void this.runAgentAndPublish({ run, message }).catch(…)`,
  3. Subscribes the HTTP response to `RunStreamHub` and pipes chunks out.
- `GET /chat/stream/resume` calls `ChatService.resumeRunToResponse`, which **just** subscribes to the same hub for the given `runId`.
- `runAgentAndPublish` owns its own `AbortController`, but **nothing wires `response.on('close')` to it** — that's intentional. Closing the tab / reloading the page must NOT abort the LLM call. If you ever add a real "stop" feature, do it as a separate `POST /chat/stream/stop` route that calls `abortController.abort()` on the background loop.
- `RunStreamHub` is an in-memory pub/sub that buffers wire chunks (`UIMessageChunk`) per `runId`, so a late subscriber (post-reload) replays the full message stream.
- Every terminal path of `runAgentAndPublish` MUST call `this.hub.close(runId, …)` — leaving the channel open leaks memory, leaving subscribers hanging.
- `runAgentAndPublish` writes a `[ChatService] run=<id> thread=<id> completed in <N>ms chunks=<M>` log on success. Watch this when verifying reload behaviour: success = `completed`, NOT `cancelled` / `failed`.

Tests in `backend/src/chat/chat.service.spec.ts` cover the disconnect-doesn't-cancel and resume-re-attaches paths. If you change `streamRunToResponse` / `resumeRunToResponse` / `runAgentAndPublish`, keep those tests honest — invert them only with strong justification.

## Markdown / math / code rendering

Assistant text is rendered by `MessageResponse` in `frontend/components/ai-elements/message.tsx` using `Streamdown` with these plugins:

- `@streamdown/cjk` (CJK shaping)
- `@streamdown/code` (Shiki-based syntax highlighting)
- `@streamdown/math` (`createMathPlugin({ singleDollarTextMath: true })`) — uses `remark-math` + `rehype-katex` under the hood
- `@streamdown/mermaid`

Two non-obvious pieces of plumbing:

### 1. CSS imports are mandatory and easy to miss

`@streamdown/math` ONLY ships the parser; its `getStyles()` returns the literal string `"katex/dist/katex.min.css"` to tell consumers what to import. Streamdown's own `streamdown/styles.css` does NOT include KaTeX styles — it only has streaming animations.

The repo therefore imports both in `frontend/app/layout.tsx` (right after `./globals.css`):

```ts
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
```

If you ever see math rendering with full-width sqrt bars, flattened fractions like `cos π/12`, or exponents drawn at full size next to the base, the very first thing to check is whether `katex/dist/katex.min.css` is still being imported. The bug looks like the LLM emitted broken LaTeX, but it's a missing stylesheet.

### 2. Math delimiter normalisation

LLMs aimed at chat surfaces frequently emit the LaTeX-native `\(...\)` (inline) and `\[...\]` (display) delimiters. Markdown happens to interpret `\(` / `\[` as character escapes, so without preprocessing, those forms leak through with the inner LaTeX unparsed.

`MessageResponse` runs `normaliseMathDelimiters(input)` BEFORE handing the text to Streamdown:

- `\[ ... \]` → `$$ ... $$`
- `\( ... \)` → `$ ... $`

If the model starts emitting yet another delimiter convention (e.g. `[math]…[/math]`, `\begin{equation}…\end{equation}`), extend that helper rather than wrapping with another component.

## Frontend chat component layout

`frontend/components/chat/LemmaConversation.tsx`:

- Settled assistant turns render as `<Message from="assistant" className="w-full min-w-0">` with NO inline avatar — the graduation-cap avatar shows ONLY in the typing indicator block (signal: "the tutor is currently speaking"). Don't add an avatar back next to settled messages without explicit product approval.
- The typing indicator (avatar + 3 bouncing dots) is gated by `showAssistantTyping = isLoading`. That's deliberately broad — the user-facing `isLoading` is true for both `submitted` and `streaming` SDK states, so the indicator stays visible across the entire loading lifecycle and doesn't flicker off the moment the SDK creates the assistant placeholder.
- Tool calls render via `<LemmaToolCall>`. `write_todos` parts are filtered out of the inline transcript because they're already rendered above the chat in `<TodoPlanPanel />`.

## Running the full stack locally (for end-to-end testing)

The fastest way to get the full stack running is the docker-compose dev stack — it builds frontend, backend, and Postgres with one command and matches CI behaviour.

### One-time env files (gitignored)

- `backend/.env.local`: `NODE_ENV=development`, `PORT=5000`, `FRONTEND_URL=http://frontend:3000`, plus `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MODEL_PROVIDER=nvidia`, `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `NVIDIA_MODEL_NAME`, and (optional but recommended) `NEO4J_*`, `QDRANT_*`, `NIM_*` so RAG paths warm up.
- `frontend/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL=http://localhost:3000`, `BACKEND_URL=http://backend:5000`.

### Start / stop

```bash
docker compose -f docker-compose.dev.yml up --build -d
docker compose -f docker-compose.dev.yml logs -f backend     # tail backend logs
docker compose -f docker-compose.dev.yml down
```

Frontend is exposed on `localhost:3000`, backend only on the docker network at `backend:5000`, Postgres on `localhost:5432`.

### Provisioning a confirmed test user

Supabase signup ordinarily requires email confirmation. Use the admin API instead so a fresh session can sign in immediately:

```bash
curl -sS -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"devin-test+'"$(date +%s)"'@example.com","password":"devin-test-pwd-'"$(date +%s)"'","email_confirm":true}'
```

Save the email/password you used, then sign in at `http://localhost:3000/login`.

### Smoke-test scenarios that have caught real bugs

1. **Resume on reload** — send a long-form prompt, wait until assistant text starts streaming, then F5. Page should re-attach and the answer should keep streaming. Confirm in backend logs:
   - No `AbortError` / `[chat_node] chat_node failed: AbortError`.
   - `run=<id> … completed in <N>ms chunks=<M>` for that run.
   The frontend banner `"Your previous response was still streaming when this page reloaded. Stream replay is..."` is the user-facing confirmation that the resume hit `/chat/stream/resume`.
2. **Avatar regression** — settled assistant bubbles should be flush-left with NO avatar; the avatar is only visible inside the typing-indicator row.
3. **Typing indicator persistence** — avatar + bouncing dots should remain visible throughout streaming, including when assistant text is partially rendered. They should NOT vanish the instant the SDK creates the assistant placeholder.
4. **Math rendering** — paste a prompt like the 2022 BAC exponential-form question. Sqrt bars should be hugged tightly to their radicand, fractions should render stacked with a horizontal bar, exponents should be small and superscripted. If anything looks linearised, check the KaTeX CSS import (above).

### Lint, typecheck, test, build

`unset NODE_ENV` first (the dev image has `NODE_ENV=production` baked in, which makes `npm ci` skip dev deps).

```bash
# Backend
(cd backend && unset NODE_ENV && npm ci --no-audit --no-fund)
(cd backend && npm run lint)
(cd backend && npx tsc --noEmit)
(cd backend && npm test -- --runInBand)
(cd backend && npm run build)

# Frontend
(cd frontend && unset NODE_ENV && npm ci --legacy-peer-deps --no-audit --no-fund)
(cd frontend && npm run lint)
(cd frontend && npx tsc --noEmit)
(cd frontend && npm run build)
```

Frontend uses `--legacy-peer-deps` because `@ai-sdk/react` peer-dep fights with React 19. Don't replace with `--force`.

## Available Devin secrets

The org/user has these chat-relevant secrets pre-provisioned: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MODEL_PROVIDER`, `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `NVIDIA_MODEL_NAME`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`, `QDRANT_DENSE_VECTOR_NAME`, `NIM_EMBED_URL`, `NIM_EMBED_MODEL`, `NIM_EMBED_DIM`, `NIM_RERANK_URL`, `NIM_RERANK_MODEL`, `POSTGRES_URI`, `PORT`, `NODE_ENV`. They are auto-injected as env vars; reference them as `$SUPABASE_URL` etc. Do NOT echo them into committed files.
