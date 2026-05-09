# Railway hosting

This repository is configured to deploy to [Railway](https://railway.com) as a
two-service project (Next.js frontend + NestJS backend) backed by a managed
Postgres add-on.

## Layout

```
lemma/
├── frontend/
│   ├── Dockerfile.prod    ← used by Railway build
│   └── railway.json       ← Railway service config (frontend)
├── backend/
│   ├── Dockerfile.prod    ← used by Railway build
│   └── railway.json       ← Railway service config (backend)
└── RAILWAY.md             ← this file
```

Each service is configured in Railway with **Root Directory** set to its
folder (`frontend` or `backend`). Railway then picks up the corresponding
`railway.json`, builds the production Dockerfile, runs the start command, and
hits the healthcheck endpoint.

| Service  | Port | Healthcheck    | Start command        |
| -------- | ---- | -------------- | -------------------- |
| frontend | 3000 | `/api/health`  | `node server.js`     |
| backend  | 5000 | `/health`      | `npm run start:prod` |

`PORT` is injected by Railway and respected by both Dockerfiles / `main.ts`.

## Required environment variables

Set these in Railway (Service → Variables). Variables are exposed both at
build time (as Docker build args, when declared with `ARG`) and at runtime.

### `frontend`

| Variable                          | Required | Notes                                                                             |
| --------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`        | yes      | Baked into the build via `Dockerfile.prod`. Supabase project URL.                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | yes      | Baked into the build. Supabase anon key.                                          |
| `NEXT_PUBLIC_SITE_URL`            | yes      | Public URL of the frontend, e.g. `https://${{RAILWAY_PUBLIC_DOMAIN}}`.            |
| `BACKEND_URL`                     | yes      | Internal backend URL, e.g. `http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:5000`.     |
| `NODE_ENV`                        | no       | Defaults to `production` in Dockerfile.                                            |

### `backend`

| Variable                          | Required | Notes                                                                             |
| --------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `SUPABASE_URL`                    | yes      | **Read at boot** — backend will not start without it.                             |
| `SUPABASE_ANON_KEY`               | yes      | **Read at boot.**                                                                  |
| `SUPABASE_SERVICE_ROLE_KEY`       | yes      | **Read at boot.** Server-side service role key.                                   |
| `FRONTEND_URL`                    | yes      | CORS allow-list, e.g. `https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}`.              |
| `POSTGRES_URI`                    | no       | Falls back to `MemorySaver`. Use `${{Postgres.DATABASE_URL}}` to wire the add-on. |
| `OPENAI_API_KEY`                  | chat     | Required only when chat is exercised (lazy-thrown).                               |
| `OPENAI_MODEL_NAME`               | no       | Defaults to `gpt-4o-mini`.                                                         |
| `MODEL_PROVIDER`                  | no       | `nvidia` (default) / `openrouter` / `openai`. Selects the chat-LLM backend.       |
| `NVIDIA_API_KEY`                  | chat     | Used by the chat LLM when `MODEL_PROVIDER=nvidia`. Also a *fallback* for the NIM embed/rerank keys below; prefer the dedicated keys so chat can be rotated independently. |
| `NVIDIA_BASE_URL`                 | no       | Defaults to `https://integrate.api.nvidia.com/v1`.                                |
| `NVIDIA_MODEL_NAME`               | no       | Chat-LLM model id (e.g. `mistralai/mistral-small-4-119b-2603`).                   |
| `NIM_EMBED_API_KEY`               | rag      | **Preferred** auth for the NIM embedding endpoint. Falls back to `NVIDIA_API_KEY` for back-compat. Set this so swapping the chat key doesn't break RAG. |
| `NIM_EMBED_URL`                   | no       | Defaults to `https://integrate.api.nvidia.com/v1/embeddings`.                     |
| `NIM_EMBED_MODEL`                 | no       | Defaults to `nvidia/llama-nemotron-embed-1b-v2`.                                  |
| `NIM_EMBED_DIM`                   | no       | Embedding dimension; must match the live Qdrant collection. Defaults to **2048** to align with the v6 collection (`bac_qa_pairs_omni_v6`, llama-nemotron-embed-1b-v2). Set to `1024` only if you point `QDRANT_COLLECTION` back at the legacy v1 collection. Mismatch ⇒ silent recall collapse, NOT an error. |
| `NIM_RERANK_API_KEY`              | rag      | **Preferred** auth for the NIM reranker. Falls back to `NVIDIA_API_KEY`. Set this so swapping the chat key doesn't disable reranking. |
| `NIM_RERANK_URL`                  | no       | Defaults to `https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking`.            |
| `NIM_RERANK_MODEL`                | no       | Defaults to `nvidia/rerank-qa-mistral-4b`.                                        |
| `EMBEDDING_MODEL`                 | no       | Optional embedding model override.                                                 |
| `QDRANT_URL` / `QDRANT_API_KEY`   | no       | Optional vector store. Tools no-op when absent.                                   |
| `QDRANT_COLLECTION` / `QDRANT_COLLECTION_NAME` | no | Optional collection override; defaults to `bac_qa_pairs_omni_v6` (v6 corpus: 302 exams, 8,412 pairs, 5 sections, 11 matières). The legacy v1 collection (`bac_qa_pairs_nim_v1`) is still readable if you point this at it AND set `NIM_EMBED_DIM=1024`. |
| `QDRANT_DENSE_VECTOR_NAME`        | no       | Defaults to `dense`.                                                              |
| `IMAGE_CDN_BASE`                  | no       | Public CDN base URL for v6 image relpaths (e.g. `https://assets.lemma.bac/omni-v6`). When set, the agent prepends it to `exercise_*_image_relpath` and `exam_full_*_relpath` so the frontend can render figures directly. When absent, raw relpaths are returned and the frontend must compose its own URL. |
| `NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD` | no | Optional knowledge graph. Tools no-op when absent.                |
| `PORT`                            | auto     | Injected by Railway.                                                              |

## First-time setup with the Railway CLI

```bash
# 1. Install
npm i -g @railway/cli

# 2. Authenticate (use an account token from https://railway.com/account/tokens)
export RAILWAY_API_TOKEN=...

# 3. Create a project
railway init --name lemma

# 4. Add Postgres
railway add --database postgres

# 5. Add the two services from this repo
railway add --service frontend --variables NEXT_PUBLIC_SITE_URL='https://placeholder' \
                                          BACKEND_URL='http://backend.railway.internal:5000' \
                                          NEXT_PUBLIC_SUPABASE_URL='...' \
                                          NEXT_PUBLIC_SUPABASE_ANON_KEY='...'
railway add --service backend  --variables SUPABASE_URL='...' \
                                          SUPABASE_ANON_KEY='...' \
                                          SUPABASE_SERVICE_ROLE_KEY='...' \
                                          FRONTEND_URL='https://placeholder' \
                                          POSTGRES_URI='${{Postgres.DATABASE_URL}}'

# 6. Set each service's Root Directory in the Railway dashboard:
#    frontend → frontend
#    backend  → backend
#    (or via the CLI: railway service settings → Source → Root Directory)

# 7. Deploy
railway up --service frontend --detach
railway up --service backend  --detach

# 8. Generate public domains
railway domain --service frontend
railway domain --service backend
```

After `frontend` has a public domain, update `NEXT_PUBLIC_SITE_URL` and
`FRONTEND_URL` (on `backend`) to that domain. After `backend` has a private
domain, confirm `BACKEND_URL` on `frontend` matches it.

## Subsequent deploys

Pushing to `main` (or whichever branch is connected) triggers Railway's
GitHub integration to build & roll out both services automatically.

CLI alternative:

```bash
railway up --service frontend --detach   # from repo root
railway up --service backend  --detach
```

## Notes / gotchas

- **`Dockerfile*` is in `.dockerignore`.** That's fine — Railway loads the
  Dockerfile *before* build context filtering, so the build still uses
  `Dockerfile.prod`.
- **Frontend build args.** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  and `NEXT_PUBLIC_SITE_URL` must be set on the frontend service before the
  first build, otherwise the bundle ships with empty values.
- **Backend boots eagerly on Supabase.** `ConfigService.getOrThrow('SUPABASE_URL')`
  runs in service constructors, so missing Supabase vars crash the deploy with
  a stack trace — set them up front.
- **Postgres is optional.** Without `POSTGRES_URI`, the LangGraph
  checkpointer falls back to `MemorySaver` (state is lost on redeploy). Wire
  `${{Postgres.DATABASE_URL}}` once Postgres is provisioned.
