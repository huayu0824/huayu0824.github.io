import { describe, expect, test } from 'bun:test';
import { rewriteHtmlLangAttribute } from '../../scripts/fix-locale-html-lang';

describe('rewriteHtmlLangAttribute', () => {
  const page =
    '<!DOCTYPE html><html lang="en" data-scroll-behavior="smooth"><head><title>x</title></head>' +
    '<body><article lang="en">hi</article><span lang="fr">bonjour</span></body></html>';

  test('rewrites only the root <html> tag lang, not inner lang attributes', () => {
    const out = rewriteHtmlLangAttribute(page, 'zh');
    expect(out).toContain('<html lang="zh" data-scroll-behavior="smooth">');
    expect(out).toContain('<article lang="en">');
    expect(out).toContain('<span lang="fr">');
  });

  test('is idempotent', () => {
    const once = rewriteHtmlLangAttribute(page, 'zh');
    expect(rewriteHtmlLangAttribute(once, 'zh')).toBe(once);
  });

  test('handles attribute order variations', () => {
    const html = '<html data-x="1" lang="en"><body></body></html>';
    expect(rewriteHtmlLangAttribute(html, 'zh')).toBe('<html data-x="1" lang="zh"><body></body></html>');
  });

  test('leaves pages without a lang attribute untouched', () => {
    const html = '<html><body></body></html>';
    expect(rewriteHtmlLangAttribute(html, 'zh')).toBe(html);
  });
});
