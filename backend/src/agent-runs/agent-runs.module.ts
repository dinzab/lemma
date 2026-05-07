import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentRunsService } from './agent-runs.service';
import { RunStreamHub } from './run-stream-hub.service';

/**
 * AgentRunsModule
 *
 * Owns lifecycle bookkeeping for `public.agent_runs` and the in-memory
 * `RunStreamHub` used to replay the Vercel AI SDK UI message stream on
 * reload / reconnect. ChatService publishes wire chunks into the hub
 * while the streaming turn is active; ChatController re-subscribes to
 * the hub when the client reconnects via `/chat/stream/resume`.
 */
@Module({
  imports: [ConfigModule],
  providers: [AgentRunsService, RunStreamHub],
  exports: [AgentRunsService, RunStreamHub],
})
export class AgentRunsModule {}
