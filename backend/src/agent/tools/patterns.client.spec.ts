import { PatternsClient } from './patterns.client';

/**
 * Smoke tests against the real curated Pattern Atlas. Tight on purpose
 * — the matcher's behaviour is intentionally simple, so we mostly just
 * verify it picks the right pattern for canonical queries we expect
 * students to type, returns null for nonsense, and respects the
 * matiere filter.
 */
describe('PatternsClient', () => {
  let client: PatternsClient;

  beforeAll(() => {
    client = new PatternsClient();
  });

  it('loads at least one pattern from the on-disk atlas', () => {
    expect(client.size()).toBeGreaterThan(0);
  });

  it.each([
    ['forme exponentielle', 'complex-numbers--exponential-form'],
    ['suite géométrique', 'sequences--geometric'],
    ['suite arithmétique', 'sequences--arithmetic'],
    ['limite d une suite', 'sequences--limit'],
    ['étude de fonction', 'calculus--function-study'],
    ['intégration par parties', 'calculus--integral-by-parts'],
    ['équation différentielle', 'calculus--differential-equation-y-prime'],
    ['probabilité conditionnelle', 'probability--conditional'],
    ['loi binomiale', 'probability--binomial-law'],
    ['dipôle RC', 'physique--rc-circuit-charge'],
    ['deuxième loi de Newton', 'physique--newton-second-law'],
    ['mitose', 'svt--mitose'],
    ['recherche dichotomique', 'info--binary-search'],
    ['clé étrangère', 'bd--foreign-key-join'],
  ])('matches "%s" → %s', (query, expectedId) => {
    const pattern = client.recall({ query });
    expect(pattern).not.toBeNull();
    expect(pattern?.id).toBe(expectedId);
  });

  it('returns null for an obviously off-topic query', () => {
    const pattern = client.recall({
      query: 'how do I bake an apple pie',
    });
    expect(pattern).toBeNull();
  });

  it('respects a matiere filter', () => {
    // "limite" matches the math limit pattern by keyword.
    const math = client.recall({
      query: 'limite suite',
      matiere: 'math',
    });
    expect(math?.id).toBe('sequences--limit');

    // The same query under physique should return null because no
    // physique-tagged pattern uses "limite" as a keyword.
    const physique = client.recall({
      query: 'limite suite',
      matiere: 'physique',
    });
    expect(physique).toBeNull();
  });

  it('is accent- and case-insensitive', () => {
    const a = client.recall({ query: 'FORME EXPONENTIELLE' });
    const b = client.recall({ query: 'forme exponentielle' });
    expect(a?.id).toBe(b?.id);
  });

  it('returns the canonical recipe with non-empty steps', () => {
    const pattern = client.recall({ query: 'forme exponentielle' });
    expect(pattern).not.toBeNull();
    expect(pattern?.recipe.length).toBeGreaterThanOrEqual(2);
    for (const step of pattern!.recipe) {
      expect(step.trim().length).toBeGreaterThan(0);
    }
    expect(pattern?.trap.length).toBeGreaterThan(0);
    expect(pattern?.genre.length).toBeGreaterThan(0);
  });
});
