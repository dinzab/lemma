import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query params for `GET /threads`.
 *
 * `limit` is capped at 50 to keep the sidebar payload small even if a client
 * crafts a huge request. The frontend sidebar uses 20 by default and pages
 * forward via `loadMore()`; clients that need more chats should paginate
 * rather than ask for a single mega-page.
 */
export class GetThreadsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(50, { message: 'limit must not exceed 50' })
  limit: number = 20;
}
