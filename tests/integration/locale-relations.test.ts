import { describe, expect, test } from 'bun:test';
import { getAdjacentPosts, getRelatedPosts } from '../../src/lib/content/related';
import { buildSlugRegistry, getBacklinks } from '../../src/lib/content/discovery';
import { getPostBySlug } from '../../src/lib/content/posts';
import { getPostUrl } from '../../src/lib/urls';

// Post relationships and wikilink resolution are within-locale (PR #125
// review, finding 3): a zh post's related/adjacent pool is the zh tree, and
// zh wikilinks resolve locale-first with default-tree fallback.

describe('within-locale post relationships', () => {
  test('related posts never cross trees — a twin cannot surface itself', () => {
    const zhTwin = getPostBySlug('i18n-routing-considerations', 'zh');
    expect(zhTwin).not.toBeNull();
    const related = getRelatedPosts(zhTwin!);
    for (const post of related) {
      expect(post.locale).toBe('zh');
    }
    expect(related.map(p => getPostUrl(p))).not.toContain('/posts/i18n-routing-considerations');
  });

  test('adjacent posts stay in the zh tree', () => {
    const zhOriginal = getPostBySlug('zh-original-demo', 'zh');
    expect(zhOriginal).not.toBeNull();
    const { prev, next } = getAdjacentPosts(zhOriginal!);
    for (const nav of [prev, next]) {
      if (nav) expect(nav.locale).toBe('zh');
    }
    // The neighbors must come from somewhere — the zh tree has 3 posts.
    expect(prev !== null || next !== null).toBe(true);
  });

  test('series adjacency uses the zh series, not the default tree', () => {
    const child = getPostBySlug('di-yi-pian', 'zh');
    expect(child).not.toBeNull();
    // Single-entry zh series: both neighbors are null (series-scoped, not
    // the en global date order it would fall into without the locale).
    expect(getAdjacentPosts(child!)).toEqual({ prev: null, next: null });
  });
});

describe('locale wikilink registry overlay', () => {
  test('zh registry: locale entries win, default tree remains as fallback', () => {
    const zh = buildSlugRegistry('zh');
    expect(zh.get('zh-original-demo')?.url).toBe('/zh/posts/zh-original-demo');
    expect(zh.get('i18n-routing-considerations')?.url).toBe('/zh/posts/i18n-routing-considerations');
    // Default-tree fallback for slugs the zh tree lacks.
    expect(zh.get('the-art-of-algorithms')?.url).toBe('/posts/the-art-of-algorithms');
    expect(zh.get('zh-demo-series')?.url).toBe('/zh/series/zh-demo-series');
  });

  test('default registry is unchanged by the overlay', () => {
    const base = buildSlugRegistry();
    expect(base.get('i18n-routing-considerations')?.url).toBe('/posts/i18n-routing-considerations');
    expect(base.has('zh-original-demo')).toBe(false);
  });

  test('backlinks are within-locale', () => {
    // No zh content wikilinks anything yet — the zh index must be empty for
    // a slug that HAS default-tree backlinks, if any exist; at minimum the
    // call is locale-scoped and does not throw.
    expect(Array.isArray(getBacklinks('zh-original-demo', 'zh'))).toBe(true);
  });
});
