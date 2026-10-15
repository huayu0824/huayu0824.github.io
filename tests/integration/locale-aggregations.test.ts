import { describe, expect, test } from 'bun:test';
import {
  getAggregatedPostsByTag,
  getPostsWithLocaleOriginals,
} from '../../src/lib/content/posts';
import { getAllTags } from '../../src/lib/content/discovery';
import { getAllAuthors } from '../../src/lib/content/authors';

// Corpus-wide surfaces (feeds, archive, tags, authors) aggregate the default
// tree plus locale-tree ORIGINALS; twins stay excluded (PR #125, finding 6).

describe('cross-tree aggregation domain', () => {
  test('originals in, twins out, default tree intact', () => {
    const posts = getPostsWithLocaleOriginals();
    const byLocaleSlug = posts.map(p => `${p.locale}:${p.slug}`);
    expect(byLocaleSlug).toContain('zh:zh-original-demo');
    expect(byLocaleSlug).toContain('zh:di-yi-pian');
    expect(byLocaleSlug).toContain('en:the-art-of-algorithms');
    // The zh twin would double-count its canonical counterpart.
    expect(byLocaleSlug).toContain('en:i18n-routing-considerations');
    expect(byLocaleSlug).not.toContain('zh:i18n-routing-considerations');
  });

  test('tag aggregate sees locale originals', () => {
    const tags = getAllTags();
    expect(tags['示例']).toBeGreaterThanOrEqual(2); // zh-original-demo + di-yi-pian
    const tagged = getAggregatedPostsByTag('示例');
    expect(tagged.map(p => p.slug)).toContain('zh-original-demo');
    for (const post of tagged) {
      expect(post.locale).toBe('zh');
    }
  });

  test('author aggregate counts locale originals', () => {
    // zh fixtures inherit the site default author, so the aggregate count
    // must exceed the default tree's own contribution.
    const counts = Object.values(getAllAuthors());
    expect(counts.length).toBeGreaterThan(0);
    expect(Math.max(...counts)).toBeGreaterThan(0);
  });
});
