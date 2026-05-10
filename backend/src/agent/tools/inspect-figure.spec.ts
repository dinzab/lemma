import { ConfigService } from '@nestjs/config';
import { AgentToolsService } from './index';
import type { QdrantClientProvider, QdrantPoint } from './qdrant.client';
import type { Neo4jClientProvider } from './neo4j.client';
import type { EmbeddingsClient } from './embeddings.client';
import type { RerankerClient } from './reranker.client';
import { VisionService, type VisionAnalysisResult } from '../vision.service';
import { FigurePerceptionCacheService } from '../figure-perception-cache.service';

/**
 * End-to-end behaviour of the `inspect_figure` tool against mocked
 * Qdrant + Vision dependencies. Pins:
 *   - cache hits short-circuit the vision call
 *   - cache misses persist on success and don't on stub
 *   - per-thread budget caps cache misses (cache hits remain free)
 *   - selector handles "all", labels, and numeric indices
 *   - missing pair / missing figure return shaped error envelopes
 */
describe('inspect_figure tool', () => {
  function configWith(
    values: Record<string, string | undefined>,
  ): ConfigService {
    return {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
  }

  function makePoint(): QdrantPoint {
    return {
      id: 'p1',
      score: 1,
      payload: {
        pair_id: 'math-2017:ex_1:q_1',
        pair_id_logical: 'math-2017:ex_1:q_1',
        matiere: 'math',
        enonce_figures: [
          {
            label: 'figure 1',
            description: 'Schéma d’un dipôle RC en série.',
            relpath: 'math-2017/figures/enonce_p0_f1.png',
          },
          {
            label: 'figure 2',
            description: 'Graphe de u(t) en fonction de t.',
            relpath: 'math-2017/figures/enonce_p0_f2.png',
          },
        ],
        corrige_figures: [],
      },
    } as unknown as QdrantPoint;
  }

  function buildService(
    opts: {
      point?: QdrantPoint | null;
      visionResult?: VisionAnalysisResult;
      visionMock?: jest.Mock;
    } = {},
  ) {
    const point = opts.point === undefined ? makePoint() : opts.point;
    const qdrant = {
      getByPairId: jest.fn().mockResolvedValue(point),
    } as unknown as QdrantClientProvider;
    const neo4j = {} as unknown as Neo4jClientProvider;
    const embeddings = {} as unknown as EmbeddingsClient;
    const reranker = {} as unknown as RerankerClient;

    const defaultVisionResult: VisionAnalysisResult = {
      analysis: {
        analysis: 'Le dipôle est en série.',
        axes: null,
        values: null,
        topology: 'RC_series',
        text_ocr: null,
        count: null,
        confidence: 0.85,
      },
      model: 'meta/llama-3.2-90b-vision-instruct',
      structured: true,
    };
    const visionMock =
      opts.visionMock ??
      jest.fn().mockResolvedValue(opts.visionResult ?? defaultVisionResult);
    const vision = {
      analyzeFigure: visionMock,
    } as unknown as VisionService;

    const cache = new FigurePerceptionCacheService(
      configWith({}), // memory mode
    );
    // No await needed; memory init is synchronous.
    void cache.onModuleInit();

    const service = new AgentToolsService(
      qdrant,
      neo4j,
      embeddings,
      reranker,
      vision,
      cache,
      configWith({ R2_PUBLIC_BASE: 'https://cdn.test/ocr_omni' }),
    );
    return { service, qdrant, vision, cache, visionMock };
  }

  function getInspectFigure(service: AgentToolsService) {
    const tool = service.getAll().find((t) => t.name === 'inspect_figure');
    if (!tool) throw new Error('inspect_figure tool missing');
    return tool;
  }

  async function invoke(
    service: AgentToolsService,
    args: Record<string, unknown>,
    threadId = 'thread-1',
  ): Promise<Record<string, unknown>> {
    const tool = getInspectFigure(service);
    const out = await tool.invoke(args, {
      configurable: { thread_id: threadId },
    });
    return JSON.parse(out as string) as Record<string, unknown>;
  }

  it('calls vision on cache miss and returns the structured perception', async () => {
    const { service, visionMock } = buildService();
    const out = await invoke(service, {
      pair_id: 'math-2017:ex_1:q_1',
      side: 'enonce',
      figure: 'figure 1',
      question: 'Le dipôle est-il en série ?',
    });
    expect(visionMock).toHaveBeenCalledTimes(1);
    expect(out.inspected_count).toBe(1);
    expect(out.cached_count).toBe(0);
    const figs = out.figures as Array<Record<string, unknown>>;
    expect(figs).toHaveLength(1);
    expect(figs[0].label).toBe('figure 1');
    expect(figs[0].cache_hit).toBe(false);
    const perception = figs[0].perception as Record<string, unknown>;
    expect(perception.topology).toBe('RC_series');
  });

  it('hits the cache on the second call and skips vision', async () => {
    const { service, visionMock } = buildService();
    await invoke(service, {
      pair_id: 'math-2017:ex_1:q_1',
      side: 'enonce',
      figure: 'figure 1',
      question: 'q',
    });
    const out = await invoke(service, {
      pair_id: 'math-2017:ex_1:q_1',
      side: 'enonce',
      figure: 'figure 1',
      question: 'q',
    });
    expect(visionMock).toHaveBeenCalledTimes(1);
    expect(out.cached_count).toBe(1);
    expect((out.figures as Array<{ cache_hit: boolean }>)[0].cache_hit).toBe(
      true,
    );
  });

  it('does not memoise stub responses (confidence=0)', async () => {
    const stub: VisionAnalysisResult = {
      analysis: {
        analysis: 'no_api_key',
        axes: null,
        values: null,
        topology: null,
        text_ocr: null,
        count: null,
        confidence: 0,
      },
      model: 'm',
      structured: false,
    };
    const visionMock = jest.fn().mockResolvedValue(stub);
    const { service } = buildService({ visionMock });
    await invoke(service, {
      pair_id: 'math-2017:ex_1:q_1',
      side: 'enonce',
      figure: 'figure 1',
    });
    await invoke(service, {
      pair_id: 'math-2017:ex_1:q_1',
      side: 'enonce',
      figure: 'figure 1',
    });
    expect(visionMock).toHaveBeenCalledTimes(2);
  });

  it('returns a shaped error when pair is missing', async () => {
    const { service, visionMock } = buildService({ point: null });
    const out = await invoke(service, {
      pair_id: 'nope',
      side: 'enonce',
    });
    expect(out.error).toMatch(/No question pair/);
    expect(out.figures).toEqual([]);
    expect(visionMock).not.toHaveBeenCalled();
  });

  it('returns a shaped error when the side has no figures', async () => {
    const { service, visionMock } = buildService();
    const out = await invoke(service, {
      pair_id: 'math-2017:ex_1:q_1',
      side: 'corrige',
    });
    expect(out.error).toMatch(/No figures on side="corrige"/);
    expect(visionMock).not.toHaveBeenCalled();
  });

  it('returns a shaped error when the figure label is unknown', async () => {
    const { service, visionMock } = buildService();
    const out = await invoke(service, {
      pair_id: 'math-2017:ex_1:q_1',
      side: 'enonce',
      figure: 'figure 99',
    });
    expect(out.error).toMatch(/figure="figure 99" not found/);
    expect(visionMock).not.toHaveBeenCalled();
  });

  it('inspects all figures on side when figure="all"', async () => {
    const { service, visionMock } = buildService();
    const out = await invoke(service, {
      pair_id: 'math-2017:ex_1:q_1',
      side: 'enonce',
      figure: 'all',
    });
    expect(visionMock).toHaveBeenCalledTimes(2);
    expect(out.inspected_count).toBe(2);
    const figs = out.figures as Array<Record<string, unknown>>;
    expect(figs.map((f) => f.label)).toEqual(['figure 1', 'figure 2']);
  });

  it('accepts a numeric figure selector (1-based index)', async () => {
    const { service, visionMock } = buildService();
    const out = await invoke(service, {
      pair_id: 'math-2017:ex_1:q_1',
      side: 'enonce',
      figure: '2',
    });
    expect(visionMock).toHaveBeenCalledTimes(1);
    const figs = out.figures as Array<{ label: string }>;
    expect(figs[0].label).toBe('figure 2');
  });

  it('returns limit_reached when the per-thread budget is exhausted', async () => {
    const { service } = buildService();
    // INSPECT_FIGURE_BUDGET_MAX is 5; force 5 cache misses on
    // distinct keys, then the 6th must short-circuit.
    for (let i = 0; i < 5; i += 1) {
      await invoke(
        service,
        {
          pair_id: 'math-2017:ex_1:q_1',
          side: 'enonce',
          figure: 'figure 1',
          question: `q-${i}`,
        },
        'budget-thread',
      );
    }
    const out = await invoke(
      service,
      {
        pair_id: 'math-2017:ex_1:q_1',
        side: 'enonce',
        figure: 'figure 1',
        question: 'q-overflow',
      },
      'budget-thread',
    );
    expect(out.error).toBe('limit_reached');
  });

  it('cache hits do not count against the per-thread budget', async () => {
    const { service, visionMock } = buildService();
    // Spend 4 budget slots on distinct questions.
    for (let i = 0; i < 4; i += 1) {
      await invoke(
        service,
        {
          pair_id: 'math-2017:ex_1:q_1',
          side: 'enonce',
          figure: 'figure 1',
          question: `q-${i}`,
        },
        'cache-budget',
      );
    }
    expect(visionMock).toHaveBeenCalledTimes(4);
    // Re-asking q-0 hits the cache → does NOT spend a slot.
    const replay = await invoke(
      service,
      {
        pair_id: 'math-2017:ex_1:q_1',
        side: 'enonce',
        figure: 'figure 1',
        question: 'q-0',
      },
      'cache-budget',
    );
    expect(replay.cached_count).toBe(1);
    // 5th distinct call still fits — cache hits did not consume budget.
    const fresh = await invoke(
      service,
      {
        pair_id: 'math-2017:ex_1:q_1',
        side: 'enonce',
        figure: 'figure 1',
        question: 'q-fresh',
      },
      'cache-budget',
    );
    expect(fresh.error).toBeUndefined();
    expect(fresh.inspected_count).toBe(1);
  });
});
