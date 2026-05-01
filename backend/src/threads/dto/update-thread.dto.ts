import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { sanitizeString } from '../../utils/sanitize';

export class UpdateThreadDto {
  @IsString({ message: 'Title must be a string' })
  @IsNotEmpty({ message: 'Title is required' })
  @MinLength(1, { message: 'Title must be at least 1 character' })
  @MaxLength(50, { message: 'Title must not exceed 50 characters' })
  @Transform(({ value }) => sanitizeString(value))
  title: string;
}
