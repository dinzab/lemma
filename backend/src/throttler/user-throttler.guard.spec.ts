import { Reflector } from '@nestjs/core';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { UserThrottlerGuard } from './user-throttler.guard';

describe('UserThrottlerGuard.getTracker', () => {
  /**
   * Sub-classed only to expose the protected `getTracker` for direct testing.
   * Production code never instantiates the guard with these stubs — Nest's DI
   * wires real options + storage + reflector.
   */
  class TestableGuard extends UserThrottlerGuard {
    public callGetTracker(req: Record<string, unknown>): Promise<string> {
      return this.getTracker(req);
    }
  }

  const guard = new TestableGuard(
    {} as ThrottlerModuleOptions,
    {
      increment: async () => ({
        totalHits: 1,
        timeToExpire: 60_000,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    } as unknown as ThrottlerStorage,
    new Reflector(),
  );

  it('keys by Supabase user id when authenticated', async () => {
    const tracker = await guard.callGetTracker({
      user: { sub: 'user-abc' },
      ip: '10.0.0.1',
    });
    expect(tracker).toBe('user:user-abc');
  });

  it('falls back to `req.user.id` if `sub` is absent', async () => {
    const tracker = await guard.callGetTracker({
      user: { id: 'user-xyz' },
      ip: '10.0.0.1',
    });
    expect(tracker).toBe('user:user-xyz');
  });

  it('falls back to ip when no user is attached', async () => {
    const tracker = await guard.callGetTracker({ ip: '10.0.0.7' });
    expect(tracker).toBe('ip:10.0.0.7');
  });

  it('returns ip:unknown when neither user nor ip is present', async () => {
    const tracker = await guard.callGetTracker({});
    expect(tracker).toBe('ip:unknown');
  });
});
