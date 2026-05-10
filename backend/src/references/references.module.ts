import { Module } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

/**
 * ReferencesModule
 *
 * Read-only resolver for the `lemma:` URI scheme used by the agent's
 * inline citation chips. Mounts `GET /references/lemma` and depends
 * on AgentModule for the shared `QdrantClientProvider` (single
 * connection pool to the v6 collection) and `R2_PUBLIC_BASE` env
 * (canonical Cloudflare R2 base URL).
 *
 * AuthModule is `@Global` so we get `SupabaseAuthGuard` injected into
 * the controller without an explicit import here.
 */
@Module({
  imports: [AgentModule],
  controllers: [ReferencesController],
  providers: [ReferencesService],
  exports: [ReferencesService],
})
export class ReferencesModule {}
