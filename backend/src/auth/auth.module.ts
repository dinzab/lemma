import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseAuthGuard } from './supabase-auth.guard';

/**
 * Auth Module
 * 
 * Provides authentication functionality using Supabase JWT verification.
 * Marked as @Global so the guard can be used across the entire application
 * without needing to import this module everywhere.
 */
@Global()
@Module({
    imports: [ConfigModule],
    providers: [SupabaseAuthGuard],
    exports: [SupabaseAuthGuard],
})
export class AuthModule { }
