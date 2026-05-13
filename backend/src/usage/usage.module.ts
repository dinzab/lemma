import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

/**
 * UsageModule — token-usage tracking and quota enforcement.
 *
 * Exports `UsageService` so `ChatModule` can:
 *   1. Check quota before starting an agent run.
 *   2. Record token consumption after a run completes.
 */
@Module({
  imports: [ConfigModule],
  controllers: [UsageController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
