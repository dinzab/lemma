import { ConfigService } from '@nestjs/config';
import { FigurePerceptionCacheService } from './figure-perception-cache.service';
import type { FigureAnalysis } from './vision.service';

/**
 * Verifies the in-memory fallback path of FigurePerceptionCacheService.
 * Postgres-mode is exercised in integration tests against a real
 * database; here we only need to confirm the LRU + key normalisation
 * semantics.
 */
describe('FigurePerceptionCacheService — memory mode', () => {
  function configWith(
    values: Record<string, string | undefined>,
  ): ConfigService {
    return {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
  }

  function fakeAnalysis(label: string): FigureAnalysis {
    return {
      analysis: label,
      axes: null,
      values: null,
      topology: null,
      text_ocr: null,
      count: null,
      confidence: 0.7,
    };
  }

  let service: FigurePerceptionCacheService;

  beforeEach(async () => {
    service = new FigurePerceptionCacheService(configWith({}));
    await service.onModuleInit();
  });

  it('reports memory mode when POSTGRES_URI is unset', () => {
    expect(service.isPostgresMode()).toBe(false);
  });

  it('returns null for missing keys', async () => {
    const out = await service.get({
      relpath: 'foo/figures/x.png',
      focus: 'general',
    });
    expect(out).toBeNull();
  });

  it('round-trips a put/get for the same key', async () => {
    const key = {
      relpath: 'foo/figures/x.png',
      focus: 'general' as const,
      question: 'Quelle est la valeur ?',
    };
    await service.put(key, fakeAnalysis('first'), 'test-model');
    const out = await service.get(key);
    expect(out?.analysis.analysis).toBe('first');
    expect(out?.model).toBe('test-model');
  });

  it('treats trivial whitespace differences in question as the same key', async () => {
    const a = {
      relpath: 'foo/figures/x.png',
      focus: 'values' as const,
      question: 'Quelle est la valeur ?',
    };
    const b = {
      relpath: 'foo/figures/x.png',
      focus: 'values' as const,
      question: '  Quelle  est la VALEUR ?  ',
    };
    await service.put(a, fakeAnalysis('alpha'), 'model');
    const out = await service.get(b);
    expect(out?.analysis.analysis).toBe('alpha');
  });

  it('keys differ across focus values', async () => {
    const base = { relpath: 'foo.png', question: 'q' };
    await service.put(
      { ...base, focus: 'general' },
      fakeAnalysis('general-result'),
      'm',
    );
    await service.put(
      { ...base, focus: 'values' },
      fakeAnalysis('values-result'),
      'm',
    );
    const general = await service.get({ ...base, focus: 'general' });
    const values = await service.get({ ...base, focus: 'values' });
    expect(general?.analysis.analysis).toBe('general-result');
    expect(values?.analysis.analysis).toBe('values-result');
  });

  it('overwrites on duplicate put', async () => {
    const key = { relpath: 'foo.png', focus: 'general' as const };
    await service.put(key, fakeAnalysis('v1'), 'm');
    await service.put(key, fakeAnalysis('v2'), 'm');
    const out = await service.get(key);
    expect(out?.analysis.analysis).toBe('v2');
  });
});
