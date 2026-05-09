import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetThreadsQueryDto } from './get-threads-query.dto';

describe('GetThreadsQueryDto', () => {
  /**
   * Mirror the global ValidationPipe options from main.ts so unit tests
   * exercise the same transform/validate pipeline as production requests.
   */
  const transform = (raw: Record<string, unknown>): GetThreadsQueryDto =>
    plainToInstance(GetThreadsQueryDto, raw, {
      enableImplicitConversion: true,
    });

  it('applies defaults (page=1, limit=20) for an empty query', async () => {
    const dto = transform({});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('coerces stringified numbers into numbers', async () => {
    const dto = transform({ page: '3', limit: '15' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(15);
  });

  it('rejects page < 1', async () => {
    const dto = transform({ page: '0' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('page');
  });

  it('rejects non-integer page', async () => {
    const dto = transform({ page: '1.5' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('page');
  });

  it('rejects limit > 50 to keep responses small', async () => {
    const dto = transform({ limit: '500' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
    expect(errors[0].constraints?.max).toMatch(/limit must not exceed 50/);
  });

  it('rejects limit < 1', async () => {
    const dto = transform({ limit: '0' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });
});
