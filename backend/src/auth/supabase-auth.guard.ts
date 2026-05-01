import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Request } from 'express';

/**
 * Supabase JWT payload interface
 */
export interface SupabaseJwtPayload {
  id: string;
  sub: string; // Alias for id, used in standard JWTs
  aud: string;
  role: string;
  email?: string;
  email_confirmed_at?: string;
  phone?: string;
  confirmed_at?: string;
  last_sign_in_at?: string;
  app_metadata: Record<string, any>;
  user_metadata: Record<string, any>;
  identities?: any[];
  created_at: string;
  updated_at: string;
}

/**
 * Extended Express Request with user information
 */
export interface AuthenticatedRequest extends Request {
  user: SupabaseJwtPayload;
}

/**
 * Supabase Auth Guard
 *
 * Validates JWTs issued by Supabase using the Supabase client.
 * This handles both HS256 and RS256 tokens automatically.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private supabase: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.getOrThrow<string>('SUPABASE_URL');
    const supabaseAnonKey =
      this.configService.getOrThrow<string>('SUPABASE_ANON_KEY');

    // Initialize a client for verification
    this.supabase = createClient(supabaseUrl, supabaseAnonKey);
  }

  /**
   * Main guard method - validates the JWT token
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }

    try {
      // Verify the token by getting the user from Supabase
      // This is the most compatible way to verify a Supabase JWT
      const {
        data: { user },
        error,
      } = await this.supabase.auth.getUser(token);

      if (error || !user) {
        console.error('Supabase auth verification failed:', error?.message);
        throw new UnauthorizedException('Invalid or expired token');
      }

      // Attach the user object to the request
      // Map the user properties to match what decorators expect
      // Specifically, add 'sub' as an alias for 'id' to maintain JWT compatibility
      const payload: SupabaseJwtPayload = {
        ...user,
        sub: user.id,
      } as SupabaseJwtPayload;

      (request as AuthenticatedRequest).user = payload;

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;

      console.error('Guard error:', error);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Extracts the Bearer token from the Authorization header
   */
  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return undefined;
    }

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
