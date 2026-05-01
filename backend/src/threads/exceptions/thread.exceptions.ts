import { NotFoundException, ForbiddenException } from '@nestjs/common';

/**
 * Exception thrown when a thread is not found in the database
 */
export class ThreadNotFoundException extends NotFoundException {
  constructor(threadId: string) {
    super({
      statusCode: 404,
      error: 'Not Found',
      message: `Thread with ID "${threadId}" not found`,
    });
  }
}

/**
 * Exception thrown when a user tries to access a thread they don't own
 */
export class ThreadAccessDeniedException extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      error: 'Forbidden',
      message: 'You do not have permission to access this thread',
    });
  }
}

/**
 * Exception thrown when thread creation fails
 */
export class ThreadCreationFailedException extends Error {
  constructor(reason?: string) {
    super(`Failed to create thread${reason ? `: ${reason}` : ''}`);
    this.name = 'ThreadCreationFailedException';
  }
}
