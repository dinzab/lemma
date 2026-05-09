import { ConfigService } from '@nestjs/config';
import { VisionService, parseVisionPayload } from './vision.service';

/**
 * Verifies VisionService's NIM-call shaping, defensive JSON parsing,
 * and non-fatal failure modes. The service must always return a
 * `VisionAnalysisResult` — never throw — so the agent can keep going
 * on a transient HTTP / parse / timeout failure.
 */
describe('VisionService', () => {
  const ORIGINAL_FETCH = global.fetch;

  function configWith(
    values: Record<string, string | undefined>,
  ): ConfigService {
    return {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
  }

  function mockOk(content: string) {
    const mock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(''),
      json: () =>
        Promise.resolve({
          choices: [{ message: { content } }],
        }),
    });
    (global as unknown as { fetch: jest.Mock }).fetch = mock;
    return mock;
  }

  function mockErr(status: number) {
    const mock = jest.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'Bad Gateway',
      text: () => Promise.resolve('upstream broke'),
      json: () => Promise.resolve({}),
    });
    (global as unknown as { fetch: jest.Mock }).fetch = mock;
    return mock;
  }

  afterEach(() => {
    (global as unknown as { fetch: typeof global.fetch }).fetch =
      ORIGINAL_FETCH;
  });

  it('returns a stub with confidence=0 when no API key is configured', async () => {
    const fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    const service = new VisionService(configWith({}));
    const out = await service.analyzeFigure({
      imageUrl: 'https://example.test/figure.png',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.structured).toBe(false);
    expect(out.analysis.confidence).toBe(0);
    expect(out.analysis.analysis).toMatch(/no_api_key/);
  });

  it('parses a well-formed JSON response and reports structured=true', async () => {
    const payload = {
      analysis: 'Le schéma montre un dipôle RC en série.',
      axes: { x: 't (s)', y: 'u_C (V)', x_range: '0..5', y_range: '0..6' },
      values: [{ x: '2.0', y: '3.7' }],
      topology: 'RC_series',
      text_ocr: ['E = 6 V', 'R = 1 kΩ'],
      count: null,
      confidence: 0.83,
    };
    const fetchMock = mockOk(JSON.stringify(payload));
    const service = new VisionService(
      configWith({ NIM_VISION_API_KEY: 'test-key' }),
    );
    const out = await service.analyzeFigure({
      imageUrl: 'https://example.test/figure.png',
      question: 'Quelle est la valeur de u(t=2) ?',
      focus: 'values',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out.structured).toBe(true);
    expect(out.analysis.analysis).toContain('RC');
    expect(out.analysis.topology).toBe('RC_series');
    expect(out.analysis.values).toEqual([{ x: '2.0', y: '3.7' }]);
    expect(out.analysis.confidence).toBeCloseTo(0.83);
    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers['Authorization']).toBe('Bearer test-key');
  });

  it('strips ```json fences before parsing', async () => {
    const payload = { analysis: 'Test.', confidence: 0.5 };
    const wrapped = '```json\n' + JSON.stringify(payload) + '\n```';
    mockOk(wrapped);
    const service = new VisionService(configWith({ NVIDIA_API_KEY: 'k' }));
    const out = await service.analyzeFigure({
      imageUrl: 'https://example.test/figure.png',
    });
    expect(out.structured).toBe(true);
    expect(out.analysis.analysis).toBe('Test.');
    expect(out.analysis.confidence).toBe(0.5);
  });

  it('falls back to a low-confidence raw envelope when JSON cannot be parsed', async () => {
    mockOk('this is not JSON at all');
    const service = new VisionService(configWith({ NVIDIA_API_KEY: 'k' }));
    const out = await service.analyzeFigure({
      imageUrl: 'https://example.test/figure.png',
    });
    expect(out.structured).toBe(false);
    expect(out.analysis.analysis).toContain('this is not JSON');
    expect(out.analysis.confidence).toBe(0.3);
  });

  it('returns a stub on HTTP error (e.g. 502)', async () => {
    mockErr(502);
    const service = new VisionService(configWith({ NVIDIA_API_KEY: 'k' }));
    const out = await service.analyzeFigure({
      imageUrl: 'https://example.test/figure.png',
    });
    expect(out.structured).toBe(false);
    expect(out.analysis.confidence).toBe(0);
    expect(out.analysis.analysis).toMatch(/http_502/);
  });

  it('prefers NIM_VISION_API_KEY over NVIDIA_API_KEY', async () => {
    const fetchMock = mockOk(
      JSON.stringify({ analysis: 'x', confidence: 0.5 }),
    );
    const service = new VisionService(
      configWith({
        NIM_VISION_API_KEY: 'vision-key',
        NVIDIA_API_KEY: 'shared-key',
      }),
    );
    await service.analyzeFigure({
      imageUrl: 'https://example.test/figure.png',
    });
    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers['Authorization']).toBe('Bearer vision-key');
  });
});

describe('parseVisionPayload', () => {
  it('rejects missing analysis field', () => {
    expect(parseVisionPayload(JSON.stringify({ confidence: 0.5 }))).toBeNull();
  });

  it('rejects empty analysis field', () => {
    expect(parseVisionPayload(JSON.stringify({ analysis: '   ' }))).toBeNull();
  });

  it('coerces non-numeric count to null', () => {
    const out = parseVisionPayload(
      JSON.stringify({ analysis: 'ok', count: 'three' }),
    );
    expect(out?.count).toBeNull();
  });

  it('clamps confidence to [0,1]', () => {
    const high = parseVisionPayload(
      JSON.stringify({ analysis: 'ok', confidence: 2 }),
    );
    expect(high?.confidence).toBe(1);
    const low = parseVisionPayload(
      JSON.stringify({ analysis: 'ok', confidence: -0.5 }),
    );
    expect(low?.confidence).toBe(0);
  });

  it('drops malformed values entries', () => {
    const out = parseVisionPayload(
      JSON.stringify({
        analysis: 'ok',
        values: [
          { x: 1, y: 2 },
          { x: 'a' }, // missing y
          'nope', // not an object
          { x: 3, y: 4 },
        ],
      }),
    );
    expect(out?.values).toEqual([
      { x: '1', y: '2' },
      { x: '3', y: '4' },
    ]);
  });
});
