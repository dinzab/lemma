import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth';
import { ThreadsModule } from './threads';
import { AgentModule } from './agent/agent.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    // ConfigModule loads environment variables from .env files
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    // AuthModule provides SupabaseAuthGuard for JWT verification
    AuthModule,
    // ThreadsModule provides thread management endpoints
    ThreadsModule,
    // AgentModule owns the LangGraph + shared CheckpointerService
    AgentModule,
    // ChatModule exposes /chat/stream + /threads/:id/messages
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
