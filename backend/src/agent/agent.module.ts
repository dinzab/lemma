import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { CheckpointerService } from './checkpointer.service';
import { LlmService } from './llm.service';
import { AgentToolsService } from './tools';
import { QdrantClientProvider } from './tools/qdrant.client';
import { Neo4jClientProvider } from './tools/neo4j.client';
import { EmbeddingsClient } from './tools/embeddings.client';
import { RerankerClient } from './tools/reranker.client';
import { AnalogiesClient } from './tools/analogies.client';
import { PatternsClient } from './tools/patterns.client';

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
    AnalogiesClient,
    PatternsClient,
    AgentToolsService,
    AgentService,
  ],
  exports: [CheckpointerService, AgentService],
})
export class AgentModule {}
