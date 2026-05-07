import { RunStreamHub, type RunStreamEvent } from './run-stream-hub.service';

/**
 * Drain an async iterator into an array, with a hard timeout so a buggy
 * hub doesn't hang the test runner forever.
 */
async function drain<T>(
  iter: AsyncGenerator<T>,
  timeoutMs = 1000,
): Promise<T[]> {
  const out: T[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await Promise.race([
      iter.next(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), timeoutMs),
      ),
    ]);
    if (r.done) break;
    out.push(r.value as T);
  }
  return out;
}

describe('RunStreamHub', () => {
  it('buffers chunks before any subscriber attaches and replays on subscribe', async () => {
    const hub = new RunStreamHub();
    const runId = 'run-1';

    hub.publish(runId, { type: 'start' });
    hub.publish(runId, { type: 'text-start', id: 't1' });
    hub.publish(runId, { type: 'text-delta', id: 't1', delta: 'hi' });
    hub.publish(runId, { type: 'text-end', id: 't1' });
    hub.publish(runId, { type: 'finish' });
    hub.close(runId, 'completed');

    const events = await drain(hub.subscribe(runId));
    const types = events.map((e) =>
      e.kind === 'chunk'
        ? (e.chunk as { type: string }).type
        : `closed:${e.reason}`,
    );
    expect(types).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-end',
      'finish',
      'closed:completed',
    ]);
  });

  it('forwards live chunks to a subscriber attached before the run finishes', async () => {
    const hub = new RunStreamHub();
    const runId = 'run-2';

    hub.publish(runId, { type: 'start' });

    const collected: RunStreamEvent[] = [];
    const consumer = (async () => {
      for await (const event of hub.subscribe(runId)) {
        collected.push(event);
        if (event.kind === 'closed') return;
      }
    })();

    // Yield to the microtask queue so the subscriber consumes the
    // replayed buffer before the next batch of publishes arrives.
    await new Promise((resolve) => setImmediate(resolve));

    hub.publish(runId, { type: 'text-delta', id: 't1', delta: 'hello' });
    hub.publish(runId, { type: 'text-delta', id: 't1', delta: ' world' });
    hub.close(runId, 'completed');

    await consumer;

    expect(collected.map((e) => e.kind)).toEqual([
      'chunk',
      'chunk',
      'chunk',
      'closed',
    ]);
    expect(
      collected
        .filter(
          (e): e is { kind: 'chunk'; chunk: unknown } => e.kind === 'chunk',
        )
        .map((e) => (e.chunk as { type: string }).type),
    ).toEqual(['start', 'text-delta', 'text-delta']);
  });

  it('emits a synthetic closed event when subscribing to an unknown run', async () => {
    const hub = new RunStreamHub();
    const events = await drain(hub.subscribe('nonexistent'));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: 'closed',
      reason: 'failed',
      error: 'Run is no longer in memory.',
    });
  });

  it('preserves order when many chunks land between subscriber awaits', async () => {
    const hub = new RunStreamHub();
    const runId = 'run-3';

    // Open the channel synchronously so the subscriber it created below
    // sees a real channel during its initial `channels.get(runId)` —
    // matches production: `agent_runs` row exists before resume.
    hub.publish(runId, { i: 0 });

    const consumer = (async () => {
      const out: number[] = [];
      for await (const event of hub.subscribe(runId)) {
        if (event.kind === 'chunk') {
          out.push((event.chunk as { i: number }).i);
        } else {
          return out;
        }
      }
      return out;
    })();

    // Yield so the subscriber consumes the replayed first chunk and
    // parks on its first waiter; then hammer the publisher to exercise
    // the drain path inside subscribe().
    await new Promise((resolve) => setImmediate(resolve));
    for (let i = 1; i < 50; i++) hub.publish(runId, { i });
    hub.close(runId, 'completed');

    const out = await consumer;
    expect(out).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('publish after close is a no-op', async () => {
    const hub = new RunStreamHub();
    const runId = 'run-4';

    hub.publish(runId, { type: 'start' });
    hub.close(runId, 'completed');
    hub.publish(runId, { type: 'text-delta', id: 't1', delta: 'late' });

    const events = await drain(hub.subscribe(runId));
    const chunks = events.filter(
      (e): e is { kind: 'chunk'; chunk: unknown } => e.kind === 'chunk',
    );
    expect(chunks.map((e) => (e.chunk as { type: string }).type)).toEqual([
      'start',
    ]);
  });

  it('close is idempotent — second close is a no-op', () => {
    const hub = new RunStreamHub();
    const runId = 'run-5';
    hub.publish(runId, { type: 'start' });
    hub.close(runId, 'completed');
    expect(() => hub.close(runId, 'failed', 'late')).not.toThrow();
    expect(hub.isLive(runId)).toBe(false);
  });

  it('isLive reflects channel state', () => {
    const hub = new RunStreamHub();
    expect(hub.isLive('unknown')).toBe(false);
    hub.publish('run-6', { type: 'start' });
    expect(hub.isLive('run-6')).toBe(true);
    hub.close('run-6', 'completed');
    expect(hub.isLive('run-6')).toBe(false);
  });

  it('evict wakes pending subscribers with a failed close', async () => {
    const hub = new RunStreamHub();
    const runId = 'run-7';
    hub.publish(runId, { type: 'start' });

    const collected: RunStreamEvent[] = [];
    const consumer = (async () => {
      for await (const event of hub.subscribe(runId)) {
        collected.push(event);
        if (event.kind === 'closed') return;
      }
    })();

    await new Promise((resolve) => setImmediate(resolve));
    hub.evict(runId);
    await consumer;

    const last = collected[collected.length - 1];
    expect(last.kind).toBe('closed');
    if (last.kind === 'closed') {
      expect(last.reason).toBe('failed');
    }
    expect(hub.isLive(runId)).toBe(false);
  });
});
