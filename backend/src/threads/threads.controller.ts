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
import { ThreadsService } from './threads.service';
import {
  CreateThreadDto,
  ThreadResponseDto,
  ThreadsListResponseDto,
  UpdateThreadDto,
} from './dto';
import { SupabaseAuthGuard, SupabaseJwtPayload } from '../auth';
import { CurrentUser } from '../decorators';

/**
 * Controller for thread management endpoints
 * All routes are protected by SupabaseAuthGuard
 */
@Controller('threads')
@UseGuards(SupabaseAuthGuard)
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
   */
  @Get()
  async getUserThreads(
    @CurrentUser() user: SupabaseJwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<ThreadsListResponseDto> {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(
      100,
      Math.max(1, parseInt(limit || '20', 10) || 20),
    );

    return this.threadsService.getUserThreads(user.sub, pageNum, limitNum);
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
