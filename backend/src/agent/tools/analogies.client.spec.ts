import { AnalogiesClient } from './analogies.client';

/**
 * Smoke tests against the real curated library file. Kept tight on
 * purpose — the matcher's behaviour is intentionally simple, so we
 * mostly just verify it picks the right anchor for a few canonical
 * queries we expect students to type, returns null for nonsense, and
 * respects the matiere filter.
 */
describe('AnalogiesClient', () => {
  let client: AnalogiesClient;

  beforeAll(() => {
    client = new AnalogiesClient();
  });

  it('loads at least one anchor from the on-disk library', () => {
    expect(client.size()).toBeGreaterThan(0);
  });

  it.each([
    ['fonction affine', 'linear-function--louage'],
    ['forme exponentielle', 'exponential-form--watch-hand'],
    ['suite géométrique', 'geometric-sequence--ccp-interest'],
    ['mitose', 'mitosis--mlawi-fold'],
    ['deuxième loi de Newton', 'newton-second-law--pushing-cart'],
    ['clé étrangère', 'foreign-key--id-card-on-form'],
    ['recherche dichotomique', 'binary-search--paper-dictionary'],
  ])('matches "%s" → %s', (query, expectedId) => {
    const anchor = client.recall({ query });
    expect(anchor).not.toBeNull();
    expect(anchor?.id).toBe(expectedId);
  });

  it('returns null for an obviously off-topic query', () => {
    const anchor = client.recall({
      query: 'how do I bake an apple pie',
    });
    expect(anchor).toBeNull();
  });

  it('respects a matiere filter', () => {
    // "limite" matches the math limit anchor by keyword.
    const math = client.recall({ query: 'limite suite', matiere: 'math' });
    expect(math?.id).toBe('limit--walking-to-hammamet');

    // The same query under physique should return null because no
    // physique-tagged anchor uses the keyword "limite".
    const physique = client.recall({
      query: 'limite suite',
      matiere: 'physique',
    });
    expect(physique).toBeNull();
  });

  it('is accent- and case-insensitive', () => {
    const a = client.recall({ query: 'FONCTION AFFINE' });
    const b = client.recall({ query: 'fonction affine' });
    expect(a?.id).toBe(b?.id);
  });
});
