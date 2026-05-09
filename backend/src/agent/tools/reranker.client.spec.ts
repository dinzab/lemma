import { ConfigService } from '@nestjs/config';
import { RerankerClient } from './reranker.client';

/**
 * Verifies API-key resolution precedence for the reranker client:
 *   NIM_RERANK_API_KEY > NVIDIA_API_KEY > NVIDEA_API_KEY (legacy typo)
 *
 * The reranker is non-fatal — when no key is configured it must skip
 * gracefully and return passages in their original order rather than
 * throwing.
 */
describe('RerankerClient — API key resolution', () => {
  const ORIGINAL_FETCH = global.fetch;

  function mockRerankOk(rankings: Array<{ index: number; logit: number }>) {
    const mock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ rankings }),
    });
    (global as unknown as { fetch: jest.Mock }).fetch = mock;
    return mock;
  }

  function configWith(
    values: Record<string, string | undefined>,
  ): ConfigService {
    return {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
  }

  function authHeaderFromMock(mock: jest.Mock): string {
    const init = mock.mock.calls[0]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    return init?.headers?.['Authorization'] ?? '';
  }

  afterEach(() => {
    (global as unknown as { fetch: typeof global.fetch }).fetch =
      ORIGINAL_FETCH;
  });

  const passages = ['alpha', 'beta', 'gamma'];
  const rerankArgs = {
    query: 'q',
    passages,
    getText: (p: string) => p,
  };

  it('prefers NIM_RERANK_API_KEY over NVIDIA_API_KEY', async () => {
    const fetchMock = mockRerankOk([
      { index: 2, logit: 0.9 },
      { index: 0, logit: 0.5 },
      { index: 1, logit: 0.1 },
    ]);
    const client = new RerankerClient(
      configWith({
        NIM_RERANK_API_KEY: 'rerank-only-key',
        NVIDIA_API_KEY: 'chat-key',
      }),
    );
    await client.rerank(rerankArgs);
    expect(authHeaderFromMock(fetchMock)).toBe('Bearer rerank-only-key');
  });

  it('falls back to NVIDIA_API_KEY when NIM_RERANK_API_KEY is unset', async () => {
    const fetchMock = mockRerankOk([
      { index: 0, logit: 0.5 },
      { index: 1, logit: 0.1 },
      { index: 2, logit: 0.0 },
    ]);
    const client = new RerankerClient(
      configWith({ NVIDIA_API_KEY: 'chat-key' }),
    );
    await client.rerank(rerankArgs);
    expect(authHeaderFromMock(fetchMock)).toBe('Bearer chat-key');
  });

  it('skips rerank gracefully when no key is configured', async () => {
    const fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    const client = new RerankerClient(configWith({}));
    const out = await client.rerank(rerankArgs);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toEqual(passages);
  });
});
