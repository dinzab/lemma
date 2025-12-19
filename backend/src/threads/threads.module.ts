import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThreadsController } from './threads.controller';
import { ThreadsService } from './threads.service';

/**
 * ThreadsModule
 * 
 * Provides thread management functionality including:
 * - CRUD operations for chat threads
 * - Ownership verification
 * - Integration with Supabase
 */
@Module({
    imports: [ConfigModule],
    controllers: [ThreadsController],
    providers: [ThreadsService],
    exports: [ThreadsService],
})
export class ThreadsModule { }
