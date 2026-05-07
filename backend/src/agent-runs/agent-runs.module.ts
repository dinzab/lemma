import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentRunsService } from './agent-runs.service';

/**
 * AgentRunsModule
 *
 * Owns lifecycle bookkeeping for `public.agent_runs`. Used by ChatService
 * to bracket each streaming turn and by ChatController for the active-run
 * lookup endpoint.
 */
@Module({
  imports: [ConfigModule],
  providers: [AgentRunsService],
  exports: [AgentRunsService],
})
export class AgentRunsModule {}
