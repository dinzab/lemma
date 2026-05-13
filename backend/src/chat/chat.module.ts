import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AgentModule } from '../agent/agent.module';
import { ThreadsModule } from '../threads/threads.module';
import { AgentRunsModule } from '../agent-runs';
import { MessagesModule } from '../messages';
import { UsageModule } from '../usage';

/**
 * ChatModule wires the streaming + paginated chat endpoints. It depends on:
 *   - AgentModule for the compiled LangGraph (AgentService),
 *   - ThreadsModule for ownership validation against the Supabase threads
 *     table before any stream byte goes out,
 *   - AgentRunsModule for streaming-turn lifecycle bookkeeping and the
 *     active-run lookup endpoint,
 *   - MessagesModule for the flat conversation log that powers the
 *     paginated history endpoint.
 */
@Module({
  imports: [
    AgentModule,
    ThreadsModule,
    AgentRunsModule,
    MessagesModule,
    UsageModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
