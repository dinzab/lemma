import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttler guard that buckets by authenticated user instead of IP.
 *
 * The frontend is a Next.js proxy living in the same Docker network, so all
 * requests arrive at the backend with the proxy's IP. Using IP would lump
 * every user together; bucketing by `req.user.sub` (set by `SupabaseAuthGuard`,
 * which always runs first on protected controllers) gives one limit per
 * Supabase user. Falls back to `req.ip` if no user is attached so unauthenticated
 * routes still get *some* rate limiting rather than none.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId: string | undefined = req?.user?.sub ?? req?.user?.id;
    if (userId) {
      return `user:${userId}`;
    }
    return `ip:${req.ip ?? 'unknown'}`;
  }
}
