import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest, SupabaseJwtPayload } from '../auth';

/**
 * @CurrentUser() Parameter Decorator
 * 
 * Extracts the authenticated user from the request object.
 * Use this in controller methods to get the current user's information.
 * 
 * @example
 * ```typescript
 * @Get('profile')
 * @UseGuards(SupabaseAuthGuard)
 * getProfile(@CurrentUser() user: SupabaseJwtPayload) {
 *   return { userId: user.sub, email: user.email };
 * }
 * ```
 * 
 * You can also extract specific properties:
 * @example
 * ```typescript
 * @Get('my-id')
 * @UseGuards(SupabaseAuthGuard)
 * getUserId(@CurrentUser('sub') userId: string) {
 *   return { userId };
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
    (data: keyof SupabaseJwtPayload | undefined, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
        const user = request.user;

        // If a specific property is requested, return only that property
        if (data) {
            return user?.[data];
        }

        // Otherwise, return the entire user object
        return user;
    },
);
