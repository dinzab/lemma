import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChatService } from './chat.service';
import { GetMessagesQueryDto, MessagesPageDto, StreamChatDto } from './dto';
import { SupabaseAuthGuard, type SupabaseJwtPayload } from '../auth';
import { CurrentUser } from '../decorators';

/**
 * ChatController — owns the two endpoints that replace the standalone
 * FastAPI agent service:
 *
 *   POST /chat/stream
 *     Body: { threadId, message }
 *     Streams a Vercel AI SDK UI message stream (SSE) for one agent turn.
 *
 *   GET /threads/:id/messages?limit=50&before=<msg_id>
 *     Cursor-paginated message read, newest-first. Powers the chat history
 *     virtualised list on the frontend.
 */
@Controller()
@UseGuards(SupabaseAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

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
}
