import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  CreateThreadDto,
  ThreadResponseDto,
  ThreadsListResponseDto,
} from './dto';
import { ThreadNotFoundException } from './exceptions/thread.exceptions';

/**
 * Service for managing chat threads in Supabase
 * Handles CRUD operations with proper authorization checks
 */
@Injectable()
export class ThreadsService {
  private supabase: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const supabaseServiceKey = this.configService.getOrThrow<string>(
      'SUPABASE_SERVICE_ROLE_KEY',
    );

    // Service role key BYPASSES Row Level Security entirely. Every query
    // in this service MUST scope itself with `.eq('user_id', userId)`
    // (or a similar explicit filter) — there is no RLS safety net.
    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  /**
   * Creates a new thread for the given user
   *
   * @param userId - The authenticated user's ID
   * @param createThreadDto - The thread creation data
   * @returns The created thread
   */
  async createThread(
    userId: string,
    createThreadDto: CreateThreadDto,
  ): Promise<ThreadResponseDto> {
    const { data, error } = await this.supabase
      .from('threads')
      .insert({
        user_id: userId,
        title: createThreadDto.title,
      })
      .select('id, title, created_at, updated_at')
      .single();

    if (error) {
      console.error('Failed to create thread:', error);
      throw new Error(`Failed to create thread: ${error.message}`);
    }

    return ThreadResponseDto.fromRecord(data);
  }

  /**
   * Retrieves a thread by ID with ownership verification
   *
   * @param threadId - The thread ID to retrieve
   * @param userId - The authenticated user's ID for ownership check
   * @returns The thread if found and owned by user
   * @throws ThreadNotFoundException if thread doesn't exist OR caller doesn't own it
   */
  async getThread(
    threadId: string,
    userId: string,
  ): Promise<ThreadResponseDto> {
    // Filter by both id AND user_id so a non-owner gets a flat 404 and
    // doesn't learn whether the thread exists. Avoids leaking the
    // existence of other users' thread IDs through the response code.
    const { data, error } = await this.supabase
      .from('threads')
      .select('id, title, user_id, created_at, updated_at')
      .eq('id', threadId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new ThreadNotFoundException(threadId);
    }

    return ThreadResponseDto.fromRecord(data);
  }

  /**
   * Lists all threads for a user, ordered by most recent first
   *
   * @param userId - The authenticated user's ID
   * @param page - Page number (1-indexed)
   * @param limit - Number of threads per page
   * @returns Paginated list of user's threads
   */
  async getUserThreads(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<ThreadsListResponseDto> {
    const offset = (page - 1) * limit;

    // Get total count
    const { count } = await this.supabase
      .from('threads')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get paginated threads
    const { data, error } = await this.supabase
      .from('threads')
      .select('id, title, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to fetch threads:', error);
      throw new Error(`Failed to fetch threads: ${error.message}`);
    }

    const threads = (data || []).map((record) =>
      ThreadResponseDto.fromRecord(record),
    );

    return new ThreadsListResponseDto(threads, count || 0, page, limit);
  }

  /**
   * Deletes a thread with ownership verification
   *
   * @param threadId - The thread ID to delete
   * @param userId - The authenticated user's ID for ownership check
   * @throws ThreadNotFoundException if thread doesn't exist OR caller doesn't own it
   */
  async deleteThread(threadId: string, userId: string): Promise<void> {
    // First verify the thread exists and user owns it
    await this.getThread(threadId, userId);

    const { error } = await this.supabase
      .from('threads')
      .delete()
      .eq('id', threadId)
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to delete thread:', error);
      throw new Error(`Failed to delete thread: ${error.message}`);
    }
  }

  /**
   * Updates a thread's title with ownership verification
   *
   * @param threadId - The thread ID to update
   * @param userId - The authenticated user's ID for ownership check
   * @param title - The new title
   * @returns The updated thread
   */
  async updateThreadTitle(
    threadId: string,
    userId: string,
    title: string,
  ): Promise<ThreadResponseDto> {
    // First verify the thread exists and user owns it
    await this.getThread(threadId, userId);

    const { data, error } = await this.supabase
      .from('threads')
      .update({ title })
      .eq('id', threadId)
      .eq('user_id', userId)
      .select('id, title, created_at, updated_at')
      .single();

    if (error) {
      console.error('Failed to update thread:', error);
      throw new Error(`Failed to update thread: ${error.message}`);
    }

    return ThreadResponseDto.fromRecord(data);
  }
}
