import { IsString, IsUUID, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class StreamChatDto {
  @IsUUID()
  threadId!: string;

  @IsString()
  message!: string;
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
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  toolCallId?: string;
  toolName?: string;
  createdAt?: string;
}

export interface MessagesPageDto {
  messages: MessageDto[];
  nextCursor: string | null;
  total: number;
}
