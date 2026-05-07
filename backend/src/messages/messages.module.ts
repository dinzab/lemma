import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MessagesService } from './messages.service';

/**
 * MessagesModule
 *
 * Owns the flat conversation log table (`public.messages`). Used by
 * ChatService for dual-writes during streaming and for the paginated
 * history endpoint.
 */
@Module({
  imports: [ConfigModule],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
