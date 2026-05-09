import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThreadsController } from './threads.controller';
import { ThreadsService } from './threads.service';
import { UserThrottlerGuard } from '../throttler/user-throttler.guard';

/**
 * ThreadsModule
 *
 * Provides thread management functionality including:
 * - CRUD operations for chat threads
 * - Ownership verification
 * - Integration with Supabase
 * - Per-user rate limiting via UserThrottlerGuard
 *
 * The Throttler config is scoped to this module rather than wired globally
 * via APP_GUARD so it does not accidentally rate-limit long-lived SSE routes
 * like /chat/stream.
 */
@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRoot({
      throttlers: [
        // 60 requests/minute per authenticated user across all thread
        // endpoints. Sidebar list + create/rename/delete combined should
        // never approach this for a real user; this is a defensive cap to
        // throttle abusive clients (loops, scripted scrapes).
        { name: 'default', ttl: 60_000, limit: 60 },
      ],
    }),
  ],
  controllers: [ThreadsController],
  providers: [ThreadsService, UserThrottlerGuard],
  exports: [ThreadsService],
})
export class ThreadsModule {}
