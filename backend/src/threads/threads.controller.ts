import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ThreadsService } from './threads.service';
import {
  CreateThreadDto,
  GetThreadsQueryDto,
  ThreadResponseDto,
  ThreadsListResponseDto,
  UpdateThreadDto,
} from './dto';
import { SupabaseAuthGuard, SupabaseJwtPayload } from '../auth';
import { CurrentUser } from '../decorators';
import { UserThrottlerGuard } from '../throttler/user-throttler.guard';

/**
 * Controller for thread management endpoints.
 *
 * SupabaseAuthGuard runs first to attach `req.user`, then UserThrottlerGuard
 * keys rate-limit buckets by `req.user.sub` (see UserThrottlerGuard for why).
 * The 60 req/min default comes from ThrottlerModule.forRoot in ThreadsModule.
 */
@Controller('threads')
@UseGuards(SupabaseAuthGuard, UserThrottlerGuard)
export class ThreadsController {
  constructor(private readonly threadsService: ThreadsService) {}

  /**
   * Create a new thread
   * POST /threads
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createThread(
    @CurrentUser() user: SupabaseJwtPayload,
    @Body() createThreadDto: CreateThreadDto,
  ): Promise<ThreadResponseDto> {
    return this.threadsService.createThread(user.sub, createThreadDto);
  }

  /**
   * Get a thread by ID
   * GET /threads/:id
   *
   * Returns the thread if it exists and belongs to the authenticated user
   * Returns 404 if not found, 403 if not authorized
   */
  @Get(':id')
  async getThread(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) threadId: string,
  ): Promise<ThreadResponseDto> {
    return this.threadsService.getThread(threadId, user.sub);
  }

  /**
   * List all threads for the authenticated user
   * GET /threads?page=1&limit=20
   *
   * The sidebar fetches 20 chats per page and lazily paginates as the user
   * scrolls; `total` in the response tells the client when to stop.
   *
   * Tighter throttle than the controller default: 30 list calls per minute
   * per user is plenty for a sidebar that pages while the user scrolls.
   */
  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async getUserThreads(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query() query: GetThreadsQueryDto,
  ): Promise<ThreadsListResponseDto> {
    return this.threadsService.getUserThreads(
      user.sub,
      query.page,
      query.limit,
    );
  }

  /**
   * Delete a thread
   * DELETE /threads/:id
   *
   * Returns 204 No Content on success
   * Returns 404 if not found, 403 if not authorized
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteThread(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) threadId: string,
  ): Promise<void> {
    await this.threadsService.deleteThread(threadId, user.sub);
  }

  @Patch(':id')
  async updateThread(
    @CurrentUser() user: SupabaseJwtPayload,
    @Param('id', new ParseUUIDPipe({ version: '4' })) threadId: string,
    @Body() updateThreadDto: UpdateThreadDto,
  ): Promise<ThreadResponseDto> {
    return this.threadsService.updateThreadTitle(
      threadId,
      user.sub,
      updateThreadDto.title,
    );
  }
}
