import { ConfigService } from '@nestjs/config';

import {
  MANDATORY_FILTER,
  QdrantClientProvider,
  mergeFilter,
} from './qdrant.client';

describe('MANDATORY_FILTER (v6 cutover)', () => {
  it('no longer carries the legacy critic_label / under_gate clauses', () => {
    // The v6 omni collection neither stores nor indexes these fields.
    // Forcing them into every read made Qdrant strict mode reject every
    // search/scroll/count with "Index required but not found", silently
    // breaking the agent tools and the /api/references resolver. The
    // grade + quarantine gates moved upstream of ingest, so the runtime
    // filter is intentionally empty.
    expect(MANDATORY_FILTER).toEqual({ must: [] });
  });
});

describe('mergeFilter', () => {
  it('returns an empty must[] when no extra filter is supplied', () => {
    expect(mergeFilter()).toEqual({ must: [] });
  });

  it('passes the caller-supplied must clauses through unchanged', () => {
    const out = mergeFilter({
      must: [{ key: 'matiere', match: { value: 'math' } }],
    });
    expect(out.must).toEqual([{ key: 'matiere', match: { value: 'math' } }]);
    expect(out.must_not).toBeUndefined();
    expect(out.should).toBeUndefined();
  });

  it('preserves must_not / should clauses verbatim', () => {
    const out = mergeFilter({
      must: [{ key: 'matiere', match: { value: 'math' } }],
      must_not: [{ key: 'session', match: { value: 'controle' } }],
      should: [{ key: 'filiere', match: { value: 'sciences-ex' } }],
    });
    expect(out.must_not).toEqual([
      { key: 'session', match: { value: 'controle' } },
    ]);
    expect(out.should).toEqual([
      { key: 'filiere', match: { value: 'sciences-ex' } },
    ]);
  });
});

describe('QdrantClientProvider', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: jest.Mock;

  function makeProvider(
    overrides: Partial<Record<string, string>> = {},
  ): QdrantClientProvider {
    const env: Record<string, string> = {
      QDRANT_URL: 'https://qdrant.test',
      QDRANT_API_KEY: 'test-key',
      QDRANT_COLLECTION: 'bac_qa_pairs_omni_v6',
      QDRANT_DENSE_VECTOR_NAME: 'dense',
      ...overrides,
    };
    const config = {
      get: <T>(key: string): T | undefined => env[key] as T | undefined,
    } as unknown as ConfigService;
    const provider = new QdrantClientProvider(config);
    provider.onModuleInit();
    return provider;
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockOkJson(body: unknown): void {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  function lastBody(): Record<string, unknown> {
    const calls = fetchMock.mock.calls;
    const call = calls[calls.length - 1];
    if (!call) throw new Error('fetch was not called');
    const init = call[1] as RequestInit;
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }

  it('searchDense forwards the caller filter without injecting critic_label / under_gate', async () => {
    mockOkJson({ result: { points: [] } });
    const qdrant = makeProvider();
    await qdrant.searchDense({
      vector: [0.1, 0.2, 0.3],
      limit: 5,
      filter: { must: [{ key: 'matiere', match: { value: 'math' } }] },
    });

    const body = lastBody();
    expect(body.using).toBe('dense');
    expect(body.limit).toBe(5);
    expect(body.with_payload).toBe(true);
    expect(body.filter).toEqual({
      must: [{ key: 'matiere', match: { value: 'math' } }],
    });
  });

  it('scrollByFilter applies the caller filter as-is on v6', async () => {
    mockOkJson({ result: { points: [] } });
    const qdrant = makeProvider();
    await qdrant.scrollByFilter({
      filter: {
        must: [{ key: 'pair_id_logical', match: { value: 'math-x:ex_1:q_1' } }],
      },
    });
    expect(lastBody().filter).toEqual({
      must: [{ key: 'pair_id_logical', match: { value: 'math-x:ex_1:q_1' } }],
    });
  });

  it('count omits legacy critic_label / under_gate clauses', async () => {
    mockOkJson({ result: { count: 42 } });
    const qdrant = makeProvider();
    const total = await qdrant.count();
    expect(total).toBe(42);
    expect(lastBody().filter).toEqual({ must: [] });
  });

  it('getByPairId tries pair_id_logical first, then falls back to pair_id', async () => {
    mockOkJson({ result: { points: [] } }); // pair_id_logical miss
    mockOkJson({
      result: {
        points: [
          {
            id: 'p',
            payload: { pair_id: 'legacy-v1-handle' },
          },
        ],
      },
    });

    const qdrant = makeProvider();
    const out = await qdrant.getByPairId('legacy-v1-handle');

    expect(out?.id).toBe('p');
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      filter: { must: { key: string }[] };
    };
    const secondBody = JSON.parse(
      fetchMock.mock.calls[1][1].body as string,
    ) as { filter: { must: { key: string }[] } };
    expect(firstBody.filter.must[0].key).toBe('pair_id_logical');
    expect(secondBody.filter.must[0].key).toBe('pair_id');
  });
});
