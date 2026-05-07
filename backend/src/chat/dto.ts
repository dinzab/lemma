import { IsString, IsUUID, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class StreamChatDto {
  @IsUUID()
  threadId!: string;

  @IsString()
  message!: string;
}

/**
 * Query string for `GET /chat/stream/resume` — re-attach a client to an
 * already-running agent turn after a reload or transient disconnect.
 * The runId is the `agent_runs.id` returned by `/threads/:id/active-run`.
 */
export class ResumeStreamQueryDto {
  @IsUUID()
  runId!: string;
}

export class GetMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  before?: string;
}

export interface MessageDto {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  /**
   * id of the agent run this message belongs to. The frontend uses
   * this to fold tool-role rows back into the dynamic-tool parts of
   * the assistant turn that owns them on history reload.
   */
  runId?: string | null;
  toolCallId?: string;
  toolName?: string;
  /** Tool call arguments — present on `role: 'tool'` rows. */
  toolInput?: unknown;
  /** Tool call return value — present on `role: 'tool'` rows. */
  toolOutput?: unknown;
  createdAt?: string;
}

export interface MessagesPageDto {
  messages: MessageDto[];
  nextCursor: string | null;
  total: number;
}
