import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import {
  GetMessagesQueryDto,
  MessagesPageDto,
  ResumeStreamQueryDto,
  StreamChatDto,
} from './dto';
import { SupabaseAuthGuard, type SupabaseJwtPayload } from '../auth';
import { CurrentUser } from '../decorators';
import { AgentRunsService, type ActiveRunDto } from '../agent-runs';
import { ThreadsService } from '../threads/threads.service';

/**
 * ChatController — owns the streaming + history endpoints that replace
 * the standalone FastAPI agent service:
 *
 *   POST /chat/stream
 *     Body: { threadId, message }
 *     Streams a Vercel AI SDK UI message stream (SSE) for one agent turn.
 *
 *   GET /threads/:id/messages?limit=50&before=<msg_id>
 *     Cursor-paginated message read, newest-first. Powers the chat history
 *     virtualised list on the frontend.
 *
 *   GET /threads/:id/active-run
 *     Returns { runId, status } for the most recent run on the thread, or
 *     { runId: null, status: 'idle' } if none. Lets the client decide
 *     whether to show "previous run failed, retry?" or to wait for an
 *     in-flight run to finalize.
 */
@Controller()
@UseGuards(SupabaseAuthGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly threads: ThreadsService,
    private readonly agentRuns: AgentRunsService,
  ) {}

  @Post('chat/stream')
  async stream(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() body: StreamChatDto,
    @Res() response: Response,
  ): Promise<void> {
    await this.chat.streamRunToResponse({
      threadId: body.threadId,
      userId: user.sub,
      message: body.message,
      response,
    });
  }

  @Get('threads/:id/messages')
  async messages(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) threadId: string,
    @Query() query: GetMessagesQueryDto,
  ): Promise<MessagesPageDto> {
    return this.chat.getMessagesPage(threadId, user.sub, {
      limit: query.limit,
      before: query.before,
    });
  }

  @Get('threads/:id/active-run')
  async activeRun(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', ParseUUIDPipe) threadId: string,
  ): Promise<ActiveRunDto> {
    // Resolve the thread first so a non-owner gets a flat 404 from
    // ThreadsService (consistent with /messages and /chat/stream).
    await this.threads.getThread(threadId, user.sub);
    return this.agentRuns.getActiveRun(threadId, user.sub);
  }

  /**
   * Re-attach to an in-flight agent turn after a reload or transient
   * network drop. The wire protocol is the same Vercel AI SDK UI message
   * stream as `POST /chat/stream`, so the frontend's `useChat` parsing
   * loop reads it the same way. Ownership is enforced by `getOwnedRun`
   * — a non-owner gets a 404 before any SSE bytes are written.
   *
   * If the run id has been evicted from memory (server restart, TTL
   * elapsed) the response is still a well-formed `start … finish`
   * envelope so the SDK doesn't hang; the client's history fetch is
   * the source of truth for content in that case.
   */
  @Get('chat/stream/resume')
  async resumeStream(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query() query: ResumeStreamQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const run = await this.chat.getOwnedRun(query.runId, user.sub);
    if (!run) {
      throw new NotFoundException(`Run ${query.runId} not found.`);
    }
    await this.chat.resumeRunToResponse({ runId: run.id, response });
  }
}
