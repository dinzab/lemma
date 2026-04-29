import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { MemorySaver, BaseCheckpointSaver } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';

/**
 * Page of messages returned by `getMessages`. The cursor is the id of the
 * **oldest** message in `messages`; pass it back as `before` to walk further
 * into the history.
 */
export interface MessagePage {
  messages: BaseMessage[];
  /** id of the oldest message returned, or null when no more pages exist. */
  nextCursor: string | null;
  /** total messages currently stored on the latest checkpoint. */
  total: number;
}

export interface GetMessagesOptions {
  limit?: number;
  /** id of the message returned at the top of the previous page. */
  before?: string;
}

/**
 * CheckpointerService — singleton wrapper around the LangGraph checkpoint
 * saver. Owned by `AgentModule` and consumed by both:
 *
 *   - the agent graph itself (`AgentService` calls `.saver` to compile it), and
 *   - the chat read path (`ChatService` calls `.getMessages(...)` for paginated
 *     thread display).
 *
 * Falls back to an in-memory saver when `POSTGRES_URI` isn't configured so
 * the backend still boots in environments without Postgres.
 */
@Injectable()
export class CheckpointerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckpointerService.name);
  private _saver?: BaseCheckpointSaver;
  private isPostgres = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const uri = this.config.get<string>('POSTGRES_URI');
    if (uri) {
      const saver = PostgresSaver.fromConnString(uri);
      // PostgresSaver requires .setup() on first use to create tables; it is
      // idempotent so re-running it on every boot is safe.
      await saver.setup();
      this._saver = saver;
      this.isPostgres = true;
      this.logger.log('Checkpointer ready (PostgresSaver)');
    } else {
      this._saver = new MemorySaver();
      this.logger.warn(
        'POSTGRES_URI not set — falling back to MemorySaver. Thread state ' +
          'will not persist across restarts.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // PostgresSaver lazily opens a pg.Pool internally; closing it isn't
    // strictly required because Nest tears the process down, but doing it
    // explicitly is cleaner for tests.
    const saver = this._saver as unknown as { end?: () => Promise<void> };
    if (this.isPostgres && typeof saver?.end === 'function') {
      try {
        await saver.end();
      } catch (err) {
        this.logger.warn(`Error closing checkpointer pool: ${String(err)}`);
      }
    }
  }

  /**
   * The underlying checkpoint saver. Pass directly to
   * `graph.compile({ checkpointer })`.
   */
  get saver(): BaseCheckpointSaver {
    if (!this._saver) {
      throw new Error('CheckpointerService not initialised yet');
    }
    return this._saver;
  }

  /**
   * Read a page of messages for a thread, newest first.
   *
   * Returns the most recent `limit` messages from the latest checkpoint,
   * sliced server-side. Cursor pagination keys off message id so the response
   * is stable even if the underlying messages array gets compacted later
   * (e.g. summarisation / sliding-window context windows).
   */
  async getMessages(
    threadId: string,
    opts: GetMessagesOptions = {},
  ): Promise<MessagePage> {
    const limit = clampLimit(opts.limit);
    const tuple = await this.saver.getTuple({
      configurable: { thread_id: threadId },
    });

    if (!tuple) {
      return { messages: [], nextCursor: null, total: 0 };
    }

    const allMessages = extractMessages(tuple.checkpoint);
    const total = allMessages.length;

    // Slice indices: we display newest-first. The "before" cursor is the id of
    // the oldest message returned previously, so we want messages strictly
    // before that index in the array.
    let endExclusive = total;
    if (opts.before) {
      const idx = allMessages.findIndex((m) => getMessageId(m) === opts.before);
      if (idx > 0) {
        endExclusive = idx;
      } else if (idx === 0) {
        // Cursor pointed at the very first message — no older ones exist.
        return { messages: [], nextCursor: null, total };
      }
      // idx === -1 → unknown cursor: be defensive and return the latest page.
    }

    const startInclusive = Math.max(0, endExclusive - limit);
    const page = allMessages.slice(startInclusive, endExclusive);
    const nextCursor =
      startInclusive > 0 && page.length > 0 ? getMessageId(page[0]) : null;

    return { messages: page, nextCursor, total };
  }
}

function clampLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit)) return 50;
  return Math.min(Math.max(1, Math.floor(limit)), 200);
}

/**
 * Pulls the messages array out of a LangGraph checkpoint. The shape is:
 * `checkpoint.channel_values.messages: BaseMessage[]` for graphs that use
 * `MessagesAnnotation`.
 */
function extractMessages(checkpoint: unknown): BaseMessage[] {
  if (!checkpoint || typeof checkpoint !== 'object') return [];
  const cv = (checkpoint as { channel_values?: Record<string, unknown> })
    .channel_values;
  if (!cv) return [];
  const messages = cv.messages;
  return Array.isArray(messages) ? (messages as BaseMessage[]) : [];
}

/**
 * BaseMessage exposes `.id` (string | undefined). We never want to crash on a
 * message without an id — fall back to its index-stable `lc_id` or a hash of
 * its content if needed; for now an empty string sentinel is enough since the
 * caller treats unknown cursors defensively.
 */
function getMessageId(msg: BaseMessage): string {
  return (msg as { id?: string }).id ?? '';
}
