import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth';
import { ThreadsModule } from './threads';

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
