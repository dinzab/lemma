import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AgentModule } from '../agent/agent.module';
import { ThreadsModule } from '../threads/threads.module';

/**
 * ChatModule wires the streaming + paginated chat endpoints. It depends on:
 *   - AgentModule for the compiled LangGraph (AgentService) and the shared
 *     CheckpointerService used to read paginated history,
 *   - ThreadsModule for ownership validation against the Supabase threads
 *     table before any stream byte goes out.
 */
@Module({
  imports: [AgentModule, ThreadsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
