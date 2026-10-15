import { describe, test, expect } from 'bun:test';
import { parseRecentSearches, getResultType, resolveTypeHotkey, type ContentType } from '@/lib/search-utils';

describe('parseRecentSearches', () => {
  test('returns valid string arrays unchanged (capped)', () => {
    expect(parseRecentSearches('["a","b"]', 5)).toEqual(['a', 'b']);
    expect(parseRecentSearches('["a","b","c"]', 2)).toEqual(['a', 'b']);
  });

  test('null / empty / invalid JSON yields an empty list', () => {
    expect(parseRecentSearches(null, 5)).toEqual([]);
    expect(parseRecentSearches('', 5)).toEqual([]);
    expect(parseRecentSearches('not json', 5)).toEqual([]);
  });

  test('non-array JSON yields an empty list', () => {
    expect(parseRecentSearches('{"a":1}', 5)).toEqual([]);
    expect(parseRecentSearches('42', 5)).toEqual([]);
    expect(parseRecentSearches('"a string"', 5)).toEqual([]);
  });

  test('drops non-string members from a mixed array', () => {
    // '[{}]' parses fine but an object rendered as a list child would throw.
    expect(parseRecentSearches('[{}]', 5)).toEqual([]);
    expect(parseRecentSearches('["keep", 42, null, {"x":1}, "also"]', 5)).toEqual(['keep', 'also']);
  });
});

describe('getResultType', () => {
  test('derives content type from the URL', () => {
    expect(getResultType('/flows/2026/01/15/')).toBe('Flow');
    expect(getResultType('/books/dmla/intro/')).toBe('Book');
    expect(getResultType('/notes/zettelkasten/')).toBe('Note');
    expect(getResultType('/posts/hello/')).toBe('Post');
    expect(getResultType('/anything-else/')).toBe('Post');
  });
});

describe('resolveTypeHotkey', () => {
  const allFive: ContentType[] = ['All', 'Post', 'Flow', 'Book', 'Note'];

  test('every visible tab is reachable, including the fifth', () => {
    // Regression: the handler hardcoded Alt+1..4, so the fifth tab ("Note")
    // advertised an ⌥5 hint that never worked.
    allFive.forEach((type, i) => {
      expect(resolveTypeHotkey(String(i + 1), allFive)).toBe(type);
    });
  });

  test('digits past the visible list resolve to nothing', () => {
    expect(resolveTypeHotkey('6', allFive)).toBeUndefined();
    expect(resolveTypeHotkey('3', ['All', 'Post'])).toBeUndefined();
  });

  test('non-digit keys resolve to nothing', () => {
    expect(resolveTypeHotkey('0', allFive)).toBeUndefined();
    expect(resolveTypeHotkey('a', allFive)).toBeUndefined();
    expect(resolveTypeHotkey('Enter', allFive)).toBeUndefined();
    expect(resolveTypeHotkey('10', allFive)).toBeUndefined();
  });
});
