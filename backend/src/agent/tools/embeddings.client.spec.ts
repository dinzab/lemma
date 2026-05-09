import { ConfigService } from '@nestjs/config';
import { EmbeddingsClient } from './embeddings.client';

/**
 * Verifies API-key resolution precedence for the embedding client:
 *   NIM_EMBED_API_KEY > NVIDIA_API_KEY > NVIDEA_API_KEY (legacy typo)
 *
 * Rotating the chat-model key (NVIDIA_API_KEY) must NOT silently
 * disable embeddings when a dedicated NIM_EMBED_API_KEY is configured.
 */
describe('EmbeddingsClient — API key resolution', () => {
  const ORIGINAL_FETCH = global.fetch;

  function mockEmbedOk(dim = 1024): jest.Mock {
    const mock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(''),
      json: () =>
        Promise.resolve({
          data: [{ embedding: new Array<number>(dim).fill(0.1) }],
        }),
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

  it('prefers NIM_EMBED_API_KEY over NVIDIA_API_KEY', async () => {
    const fetchMock = mockEmbedOk();
    const client = new EmbeddingsClient(
      configWith({
        NIM_EMBED_API_KEY: 'embed-only-key',
        NVIDIA_API_KEY: 'chat-key',
      }),
    );
    await client.embed('test query');
    expect(authHeaderFromMock(fetchMock)).toBe('Bearer embed-only-key');
  });

  it('falls back to NVIDIA_API_KEY when NIM_EMBED_API_KEY is unset', async () => {
    const fetchMock = mockEmbedOk();
    const client = new EmbeddingsClient(
      configWith({ NVIDIA_API_KEY: 'chat-key' }),
    );
    await client.embed('test query');
    expect(authHeaderFromMock(fetchMock)).toBe('Bearer chat-key');
  });

  it('falls back to legacy NVIDEA_API_KEY typo as last resort', async () => {
    const fetchMock = mockEmbedOk();
    const client = new EmbeddingsClient(
      configWith({ NVIDEA_API_KEY: 'legacy-typo-key' }),
    );
    await client.embed('test query');
    expect(authHeaderFromMock(fetchMock)).toBe('Bearer legacy-typo-key');
  });

  it('throws a clear error when no key is configured', async () => {
    const client = new EmbeddingsClient(configWith({}));
    await expect(client.embed('test query')).rejects.toThrow(
      /NIM_EMBED_API_KEY/,
    );
  });
});
