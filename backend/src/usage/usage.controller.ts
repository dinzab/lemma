import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsageService } from './usage.service';
import { SupabaseAuthGuard, type SupabaseJwtPayload } from '../auth';
import { CurrentUser } from '../decorators';
import type { UsageSnapshot } from './usage.types';

/**
 * UsageController — exposes the user's current token usage and plan
 * details so the frontend settings page can render usage bars and
 * refresh countdowns.
 *
 *   GET /usage
 *     Returns a UsageSnapshot for the authenticated user.
 */
@Controller('usage')
@UseGuards(SupabaseAuthGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  async getUsage(
    @CurrentUser() user: SupabaseJwtPayload,
  ): Promise<UsageSnapshot> {
    return this.usage.getUsageSnapshot(user.sub);
  }
}
