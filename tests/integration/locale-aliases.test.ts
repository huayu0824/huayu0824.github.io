import { describe, expect, test } from 'bun:test';
import {
  collectSingleSegmentAliases,
  findSeriesByRedirectFrom,
  postsAcrossTrees,
  resolvePrefixedPost,
  resolveSeriesParam,
  resolveTopLevelSlug,
  seriesSlugParams,
  topLevelSlugParams,
} from '../../src/lib/route-aliases';
import { getReservedRouteSegments } from '../../src/lib/urls';

// Migration aliases: content that moved into a locale tree keeps its old
// unprefixed URLs alive as redirect pages targeting the /zh/ URL. Fixtures:
// - zh-original-demo declares redirectFrom "/old-zh-demo-path" (1-segment)
// - zh-demo-series index declares "/series/zh-demo-series-old"
// - di-yi-pian declares "/old-series/di-yi-pian" (2-segment)

describe('cross-tree migration aliases', () => {
  test('1-segment alias resolves to the /zh/ target and is generated', () => {
    const resolution = resolveTopLevelSlug('old-zh-demo-path');
    expect(resolution).toMatchObject({ kind: 'redirect', to: '/zh/posts/zh-original-demo' });
    expect(topLevelSlugParams().map(p => p.slug)).toContain('old-zh-demo-path');
  });

  test('2-segment alias resolves through the default-tree route to the /zh/ target', () => {
    const resolution = resolvePrefixedPost('old-series', 'di-yi-pian');
    expect(resolution).toMatchObject({ kind: 'redirect', to: '/zh/zh-demo-series/di-yi-pian' });
  });

  test('series alias redirects into the locale tree', () => {
    const found = findSeriesByRedirectFrom('/series/zh-demo-series-old');
    expect(found?.slug).toBe('zh-demo-series');
    expect(found?.data.locale).toBe('zh');

    const resolution = resolveSeriesParam('zh-demo-series-old');
    expect(resolution.kind).toBe('alias');
    if (resolution.kind === 'alias') {
      expect(resolution.canonicalSlug).toBe('zh-demo-series');
      expect(resolution.data.locale).toBe('zh');
    }

    expect(seriesSlugParams().map(p => p.slug)).toContain('zh-demo-series-old');
  });

  test('alias scan domain spans every tree', () => {
    const slugs = postsAcrossTrees().map(p => `${p.locale}:${p.slug}`);
    expect(slugs).toContain('en:the-art-of-algorithms');
    expect(slugs).toContain('zh:zh-original-demo');
  });

  test('cross-tree alias collisions throw (strict build)', () => {
    const reserved = new Set(['claimed-alias']);
    const posts = [
      { slug: 'zh-post', series: undefined, redirectFrom: ['/claimed-alias'], locale: 'zh' },
    ];
    expect(() => collectSingleSegmentAliases(posts, reserved)).toThrow(/conflicts with an existing/);
  });

  test('locale-prefixed alias sources are rejected via reserved segments', () => {
    const posts = [{ slug: 'p', series: undefined, redirectFrom: ['/zh'] }];
    expect(() => collectSingleSegmentAliases(posts, new Set(getReservedRouteSegments()))).toThrow();
  });

  test('aliases never resolve under a locale prefix', () => {
    // /zh/old-zh-demo-path must 404 — the alias page lives unprefixed only.
    expect(resolvePrefixedPost('zh', 'old-zh-demo-path', 'zh')).toBeNull();
  });
});
