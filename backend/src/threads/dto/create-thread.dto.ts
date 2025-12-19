import { IsString, IsNotEmpty, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeString } from '../../utils/sanitize';

/**
 * DTO for creating a new thread
 * Validates and sanitizes the title to prevent XSS attacks
 */
export class CreateThreadDto {
    @IsString({ message: 'Title must be a string' })
    @IsNotEmpty({ message: 'Title is required' })
    @MinLength(1, { message: 'Title must be at least 1 character' })
    @MaxLength(50, { message: 'Title must not exceed 50 characters' })
    @Transform(({ value }) => sanitizeString(value))
    title: string;
}
