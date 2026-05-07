import { Injectable, Logger } from '@nestjs/common';

/**
 * One Vercel AI SDK UI message stream chunk. We deliberately keep the
 * type at `unknown` here because the hub doesn't need to interpret the
 * payload — it only buffers + fans out the same shape the chat service
 * is already writing to the client.
 */
export type RunStreamChunk = unknown;

interface RunStreamChannel {
  /** Every chunk seen so far, in order. New subscribers replay this first. */
  buffer: RunStreamChunk[];
  /** Subscribers awaiting the next chunk. */
  waiters: Array<(value: RunStreamEvent) => void>;
  /** Set once the run reaches a terminal state. */
  closed: boolean;
  closedReason?: 'completed' | 'failed' | 'cancelled';
  closedError?: string | null;
  /** Eviction timer id, set when the channel closes. */
  evictTimer?: ReturnType<typeof setTimeout>;
}

export type RunStreamEvent =
  | { kind: 'chunk'; chunk: RunStreamChunk }
  | {
      kind: 'closed';
      reason: 'completed' | 'failed' | 'cancelled';
      error: string | null;
    };

/**
 * RunStreamHub — in-memory pub/sub keyed by `runId` so reload + reconnect
 * can re-attach to an in-flight Vercel AI SDK UI message stream.
 *
 * Lifecycle of a run:
 *
 *   ChatService.streamRunToResponse()
 *     hub.publish(runId, chunk)   ← fires for every wire chunk
 *     hub.publish(runId, chunk)
 *     ...
 *     hub.close(runId, 'completed')   ← terminal
 *
 * Resume endpoint subscribes via `subscribe(runId)`:
 *   1. Replays everything in the buffer (so the client sees the same
 *      ordered text/tool/text/tool/text history the live consumer saw).
 *   2. Awaits future chunks until `close()` fires, then exits.
 *
 * Closed channels are evicted from memory after `EVICT_TTL_MS` so a
 * client that came online minutes after the turn finished can still
 * fetch state via the persisted `messages` table.
 *
 * NOTE: this is a single-process hub. If the backend ever scales to
 * multiple replicas, this needs to move to a shared transport
 * (Redis pub/sub, NATS, …). The interface is shaped so a swap is
 * mechanical rather than architectural.
 */
@Injectable()
export class RunStreamHub {
  private readonly logger = new Logger(RunStreamHub.name);
  /** Keep closed channels addressable for this long so late reconnects
   *  still get the buffered tail. Five minutes is comfortably longer
   *  than any realistic chat turn. */
  private static readonly EVICT_TTL_MS = 5 * 60 * 1000;

  private readonly channels = new Map<string, RunStreamChannel>();

  /**
   * Append a chunk to a run's buffer and fan it out to any subscribers
   * currently awaiting. Idempotent w.r.t. subscriber count: if there
   * are no subscribers, the chunk is just buffered and a future
   * subscriber will replay it.
   *
   * Calls AFTER `close()` are silently dropped — the buffer is frozen
   * once the run is terminal.
   */
  publish(runId: string, chunk: RunStreamChunk): void {
    const channel = this.ensure(runId);
    if (channel.closed) return;
    channel.buffer.push(chunk);
    const waiters = channel.waiters;
    channel.waiters = [];
    for (const w of waiters) {
      w({ kind: 'chunk', chunk });
    }
  }

  /**
   * Mark a run as terminal. Wakes every pending subscriber with a
   * `closed` event so their async iterators exit cleanly. Schedules
   * the channel for eviction after the TTL.
   *
   * Idempotent — the chat service may call this from both the success
   * path and a finally-style cleanup.
   */
  close(
    runId: string,
    reason: 'completed' | 'failed' | 'cancelled',
    error: string | null = null,
  ): void {
    const channel = this.channels.get(runId);
    if (!channel || channel.closed) return;
    channel.closed = true;
    channel.closedReason = reason;
    channel.closedError = error;

    const waiters = channel.waiters;
    channel.waiters = [];
    for (const w of waiters) {
      w({ kind: 'closed', reason, error });
    }

    channel.evictTimer = setTimeout(() => {
      this.channels.delete(runId);
    }, RunStreamHub.EVICT_TTL_MS);
  }

  /**
   * Subscribe to a run. Yields every buffered chunk first (in original
   * order) and then awaits live chunks until the channel closes. Exits
   * the iterator once the run is terminal.
   *
   * If the runId is unknown (server restarted, eviction TTL elapsed),
   * resolves immediately with a synthetic `closed: 'failed'` event so
   * the caller can fall back to the persisted history endpoint.
   */
  async *subscribe(runId: string): AsyncGenerator<RunStreamEvent> {
    const channel = this.channels.get(runId);
    if (!channel) {
      yield {
        kind: 'closed',
        reason: 'failed',
        error: 'Run is no longer in memory.',
      };
      return;
    }

    // 1. Replay the buffer. We snapshot the length so any chunk that
    //    arrives concurrently is picked up by the live loop below.
    const replayLen = channel.buffer.length;
    for (let i = 0; i < replayLen; i++) {
      yield { kind: 'chunk', chunk: channel.buffer[i] };
    }
    let cursor = replayLen;

    // 2. If the channel was already closed when we subscribed, drain
    //    anything that arrived between the snapshot and now, then emit
    //    the close event and exit.
    if (channel.closed) {
      while (cursor < channel.buffer.length) {
        yield { kind: 'chunk', chunk: channel.buffer[cursor++] };
      }
      yield {
        kind: 'closed',
        reason: channel.closedReason ?? 'completed',
        error: channel.closedError ?? null,
      };
      return;
    }

    // 3. Await live events. Each await registers a one-shot waiter
    //    that the publisher resolves; we then drain any buffered chunks
    //    (publisher can add several before the waiter runs) and loop.
    while (true) {
      // The publisher may have closed the channel synchronously while
      // we were yielding the previous batch — re-check before parking
      // a new waiter that would otherwise hang forever.
      if (channel.closed) {
        while (cursor < channel.buffer.length) {
          yield { kind: 'chunk', chunk: channel.buffer[cursor++] };
        }
        yield {
          kind: 'closed',
          reason: channel.closedReason ?? 'completed',
          error: channel.closedError ?? null,
        };
        return;
      }

      const event = await new Promise<RunStreamEvent>((resolve) => {
        channel.waiters.push(resolve);
      });

      if (event.kind === 'chunk') {
        // The waiter resolves with one chunk, but the publisher may
        // have appended more between our `cursor` and now if multiple
        // calls were batched into the same microtask. Drain to the
        // current buffer end before parking the next waiter.
        while (cursor < channel.buffer.length) {
          yield { kind: 'chunk', chunk: channel.buffer[cursor++] };
        }
        continue;
      }

      // closed → drain the tail then exit.
      while (cursor < channel.buffer.length) {
        yield { kind: 'chunk', chunk: channel.buffer[cursor++] };
      }
      yield event;
      return;
    }
  }

  /**
   * `true` while the run is in memory and hasn't reached a terminal
   * state. Used by the controller to decide "live resume" vs.
   * "fall back to history" without needing to subscribe.
   */
  isLive(runId: string): boolean {
    const channel = this.channels.get(runId);
    return !!channel && !channel.closed;
  }

  /**
   * Force-evict a channel. Tests use this; production relies on the
   * TTL set in `close()`. Cancels any pending timer and wakes
   * outstanding waiters with a `closed: 'failed'` event so they exit.
   */
  evict(runId: string): void {
    const channel = this.channels.get(runId);
    if (!channel) return;
    if (channel.evictTimer) clearTimeout(channel.evictTimer);
    if (!channel.closed) {
      const waiters = channel.waiters;
      channel.waiters = [];
      for (const w of waiters) {
        w({
          kind: 'closed',
          reason: 'failed',
          error: 'Run channel evicted before completion.',
        });
      }
    }
    this.channels.delete(runId);
  }

  private ensure(runId: string): RunStreamChannel {
    let channel = this.channels.get(runId);
    if (!channel) {
      channel = { buffer: [], waiters: [], closed: false };
      this.channels.set(runId, channel);
    }
    return channel;
  }
}
