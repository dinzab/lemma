import { buildImageUrl } from './index';

/**
 * Unit tests for `buildImageUrl`.
 *
 * Pinning the contract that — regardless of how `R2_PUBLIC_BASE` is
 * configured (with or without the `/ocr_omni` path suffix) and
 * regardless of whether the relpath itself happens to include the
 * prefix — the function always produces the same canonical URL with
 * exactly one `ocr_omni/` segment between the bucket origin and the
 * relpath. Pre-fix, the bare-bucket form returned a 404-ing URL.
 */
describe('buildImageUrl', () => {
  const RELPATH =
    '2020_principale_economie_gestion_math/exercises_v4/exercise_1_enonce.png';
  const EXPECTED =
    'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev/ocr_omni/' +
    '2020_principale_economie_gestion_math/exercises_v4/exercise_1_enonce.png';

  it('inserts the ocr_omni/ prefix when the base is the bare bucket origin', () => {
    expect(
      buildImageUrl(
        RELPATH,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev',
      ),
    ).toBe(EXPECTED);
  });

  it('does not duplicate the prefix when the base already ends with /ocr_omni', () => {
    expect(
      buildImageUrl(
        RELPATH,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev/ocr_omni',
      ),
    ).toBe(EXPECTED);
  });

  it('tolerates a trailing slash on the base', () => {
    expect(
      buildImageUrl(
        RELPATH,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev/ocr_omni/',
      ),
    ).toBe(EXPECTED);
    expect(
      buildImageUrl(
        RELPATH,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev/',
      ),
    ).toBe(EXPECTED);
  });

  it('does not duplicate the prefix when the relpath already includes it', () => {
    expect(
      buildImageUrl(
        `ocr_omni/${RELPATH}`,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev',
      ),
    ).toBe(EXPECTED);
  });

  it('strips a leading slash on the relpath', () => {
    expect(
      buildImageUrl(
        `/${RELPATH}`,
        'https://pub-070ce3c008c44a0e95c52fb69250b046.r2.dev',
      ),
    ).toBe(EXPECTED);
  });

  it('returns null for empty / non-string relpaths', () => {
    expect(
      buildImageUrl('', 'https://pub-x.r2.dev/ocr_omni'),
    ).toBeNull();
    expect(
      buildImageUrl(null, 'https://pub-x.r2.dev/ocr_omni'),
    ).toBeNull();
    expect(
      buildImageUrl(undefined, 'https://pub-x.r2.dev/ocr_omni'),
    ).toBeNull();
    expect(
      buildImageUrl(42, 'https://pub-x.r2.dev/ocr_omni'),
    ).toBeNull();
  });

  it('falls back to the raw relpath when no cdnBase is configured', () => {
    // The frontend then either composes its own URL or shows a "no
    // asset" placeholder — the API contract is "raw relpath, never
    // crash".
    expect(buildImageUrl(RELPATH, undefined)).toBe(RELPATH);
    expect(buildImageUrl(RELPATH, '')).toBe(RELPATH);
  });
});
