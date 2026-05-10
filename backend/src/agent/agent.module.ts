import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { CheckpointerService } from './checkpointer.service';
import { LlmService } from './llm.service';
import { AgentToolsService } from './tools';
import { QdrantClientProvider } from './tools/qdrant.client';
import { Neo4jClientProvider } from './tools/neo4j.client';
import { EmbeddingsClient } from './tools/embeddings.client';
import { RerankerClient } from './tools/reranker.client';
import { VisionService } from './vision.service';
import { FigurePerceptionCacheService } from './figure-perception-cache.service';

/**
 * AgentModule wires up:
 *   - the singleton CheckpointerService (shared with ChatModule)
 *   - the LLM factory
 *   - the data clients (Qdrant, Neo4j, NIM embeddings + reranker)
 *   - the compiled LangGraph (AgentService)
 *
 * Both CheckpointerService and AgentService are exported so ChatModule can
 * inject them — matches the architecture user requested where the
 * checkpointer is a service that both the controller and the agent consume.
 */
@Module({
  providers: [
    CheckpointerService,
    LlmService,
    QdrantClientProvider,
    Neo4jClientProvider,
    EmbeddingsClient,
    RerankerClient,
    VisionService,
    FigurePerceptionCacheService,
    AgentToolsService,
    AgentService,
  ],
  exports: [
    CheckpointerService,
    AgentService,
    // Surface the Qdrant client + the relpath-aware image URL helper
    // (lives on AgentToolsService via `imageCdnBase`) so adjacent
    // modules — like ReferencesModule's `lemma:` URI resolver — can
    // reuse the same connection pool + the canonical R2 URL shape
    // without re-implementing the `ocr_omni/` prefix normalisation.
    QdrantClientProvider,
  ],
})
export class AgentModule {}
