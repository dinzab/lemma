import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { SupabaseAuthGuard, SupabaseJwtPayload } from './auth';
import { CurrentUser } from './decorators';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'backend',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    };
  }

  /**
   * Protected route example - requires valid Supabase JWT
   * Returns the authenticated user's information
   */
  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  getMe(@CurrentUser() user: SupabaseJwtPayload) {
    return {
      userId: user.sub,
      email: user.email,
      phone: user.phone,
      role: user.role,
      appMetadata: user.app_metadata,
      userMetadata: user.user_metadata,
    };
  }
}
