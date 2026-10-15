import { describe, expect, test } from 'bun:test';
import {
  delocalizePath,
  localeFromPathname,
  localeStickyHref,
  localizePath,
  nextSwitchableLocale,
  nonDefaultLocales,
  resolveSwitchTarget,
  splitLocalePath,
  type LocalePathConfig,
} from '../../src/lib/locale-urls';
import {
  RESERVED_ROUTE_SEGMENTS,
  getNonDefaultLocales,
  getReservedRouteSegments,
  localizeUrl,
  splitLocaleFromPath,
  validateSeriesAutoPaths,
} from '../../src/lib/urls';
import { collectSingleSegmentAliases } from '../../src/lib/route-aliases';
import { validateSiteConfig } from '../../src/lib/config-schema';
import { siteConfig } from '../../site.config';

// The pure helpers must be defaultLocale-agnostic: a zh-default site prefixes
// /en/ exactly as an en-default site prefixes /zh/. Both configs are exercised
// throughout (design invariant from the locale-routing plan).
const EN_DEFAULT: LocalePathConfig = { locales: ['en', 'zh'], defaultLocale: 'en' };
const ZH_DEFAULT: LocalePathConfig = { locales: ['zh', 'en'], defaultLocale: 'zh' };
const DISABLED: LocalePathConfig = { locales: [], defaultLocale: 'en' };

describe('locale-urls pure helpers', () => {
  test('nonDefaultLocales excludes the default', () => {
    expect(nonDefaultLocales(EN_DEFAULT)).toEqual(['zh']);
    expect(nonDefaultLocales(ZH_DEFAULT)).toEqual(['en']);
    expect(nonDefaultLocales(DISABLED)).toEqual([]);
  });

  test('localizePath prefixes non-default locales and preserves trailing slash', () => {
    expect(localizePath('/posts/foo/', 'zh', EN_DEFAULT)).toBe('/zh/posts/foo/');
    expect(localizePath('/posts/foo', 'zh', EN_DEFAULT)).toBe('/zh/posts/foo');
    expect(localizePath('/', 'zh', EN_DEFAULT)).toBe('/zh/');
  });

  test('localizePath is the identity for the default locale', () => {
    expect(localizePath('/posts/foo/', 'en', EN_DEFAULT)).toBe('/posts/foo/');
    expect(localizePath('/posts/foo/', 'zh', ZH_DEFAULT)).toBe('/posts/foo/');
  });

  test('zh-default config prefixes /en/', () => {
    expect(localizePath('/posts/foo/', 'en', ZH_DEFAULT)).toBe('/en/posts/foo/');
    expect(splitLocalePath('/en/posts/foo/', ZH_DEFAULT)).toEqual({ locale: 'en', path: '/posts/foo/' });
    expect(splitLocalePath('/posts/foo/', ZH_DEFAULT)).toEqual({ locale: 'zh', path: '/posts/foo/' });
  });

  test('splitLocalePath handles the locale root with and without trailing slash', () => {
    expect(splitLocalePath('/zh', EN_DEFAULT)).toEqual({ locale: 'zh', path: '/' });
    expect(splitLocalePath('/zh/', EN_DEFAULT)).toEqual({ locale: 'zh', path: '/' });
  });

  test('splitLocalePath only matches exact segments, not prefixes', () => {
    expect(splitLocalePath('/zhong/foo/', EN_DEFAULT)).toEqual({ locale: 'en', path: '/zhong/foo/' });
  });

  test('splitLocalePath keeps encoded and raw CJK segments intact', () => {
    expect(splitLocalePath('/zh/posts/%E4%B8%AD%E6%96%87%E6%B5%8B%E8%AF%95/', EN_DEFAULT)).toEqual({
      locale: 'zh',
      path: '/posts/%E4%B8%AD%E6%96%87%E6%B5%8B%E8%AF%95/',
    });
    expect(splitLocalePath('/zh/posts/中文测试文章/', EN_DEFAULT)).toEqual({
      locale: 'zh',
      path: '/posts/中文测试文章/',
    });
  });

  test('delocalize(localize(p)) round-trips for every locale and path shape', () => {
    const paths = ['/', '/about/', '/posts/foo', '/books/dmla/maths/linear/intro/', '/tags/编程/'];
    for (const config of [EN_DEFAULT, ZH_DEFAULT]) {
      for (const locale of config.locales) {
        for (const path of paths) {
          expect(delocalizePath(localizePath(path, locale, config), config)).toBe(path);
        }
      }
    }
  });

  test('localeFromPathname falls back to the default for null pathnames', () => {
    expect(localeFromPathname(null, EN_DEFAULT)).toBe('en');
    expect(localeFromPathname(undefined, ZH_DEFAULT)).toBe('zh');
    expect(localeFromPathname('/zh/about/', EN_DEFAULT)).toBe('zh');
  });
});

describe('resolveSwitchTarget (LanguageSwitch navigation core)', () => {
  // zh entry: paths existing in the zh tree (originals included);
  // en entry: default-side paths reachable from a locale page (twins/chrome).
  const manifest = {
    zh: ['/about/', '/posts/foo/', '/posts/', '/', '/posts/zh-original-demo/'],
    en: ['/about/', '/posts/foo/', '/posts/', '/'],
  };

  test('en page with a zh twin → the zh twin', () => {
    expect(resolveSwitchTarget('/about/', 'en', 'zh', manifest, EN_DEFAULT)).toBe('/zh/about/');
    expect(resolveSwitchTarget('/posts/foo', 'en', 'zh', manifest, EN_DEFAULT)).toBe('/zh/posts/foo/');
  });

  test('en page without a zh twin → the zh home', () => {
    expect(resolveSwitchTarget('/posts/untranslated/', 'en', 'zh', manifest, EN_DEFAULT)).toBe('/zh/');
  });

  test('zh twin page back to en → the unprefixed page', () => {
    expect(resolveSwitchTarget('/zh/about/', 'zh', 'en', manifest, EN_DEFAULT)).toBe('/about/');
  });

  test('zh-original page (no en twin) back to en → the en home', () => {
    expect(resolveSwitchTarget('/zh/posts/zh-original-demo/', 'zh', 'en', manifest, EN_DEFAULT)).toBe('/');
  });

  test('twins between two NON-default locales switch directly', () => {
    // zh/fr share a path with no default-tree side (second review, finding 6).
    const threeLocales = { locales: ['en', 'zh', 'fr'], defaultLocale: 'en' };
    const pairManifest = { zh: ['/posts/shared/', '/'], fr: ['/posts/shared/', '/'] };
    expect(resolveSwitchTarget('/zh/posts/shared/', 'zh', 'fr', pairManifest, threeLocales)).toBe('/fr/posts/shared/');
    expect(resolveSwitchTarget('/fr/posts/shared/', 'fr', 'zh', pairManifest, threeLocales)).toBe('/zh/posts/shared/');
    // …and back to the default falls to home: no en side exists.
    expect(resolveSwitchTarget('/zh/posts/shared/', 'zh', 'en', pairManifest, threeLocales)).toBe('/');
  });

  test('null pathname and empty manifest degrade to homes', () => {
    expect(resolveSwitchTarget(null, 'en', 'zh', {}, EN_DEFAULT)).toBe('/zh/');
    expect(resolveSwitchTarget(null, 'zh', 'en', {}, EN_DEFAULT)).toBe('/');
  });

  test('defaultLocale-agnostic: zh-default site switching to en', () => {
    const zhManifest = { en: ['/about/'], zh: ['/about/'] };
    expect(resolveSwitchTarget('/about/', 'zh', 'en', zhManifest, ZH_DEFAULT)).toBe('/en/about/');
    expect(resolveSwitchTarget('/en/about/', 'en', 'zh', zhManifest, ZH_DEFAULT)).toBe('/about/');
    expect(resolveSwitchTarget('/en/original/', 'en', 'zh', zhManifest, ZH_DEFAULT)).toBe('/');
  });
});

describe('urls.ts config-bound locale helpers', () => {
  // site.config.ts in this repo: { enabled: true, defaultLocale: 'en', locales: ['en', 'zh'] }
  test('getNonDefaultLocales reflects site.config', () => {
    expect(getNonDefaultLocales()).toEqual(['zh']);
  });

  test('localizeUrl / splitLocaleFromPath bind site.config', () => {
    expect(localizeUrl('/posts/foo/', 'zh')).toBe('/zh/posts/foo/');
    expect(localizeUrl('/posts/foo/', 'en')).toBe('/posts/foo/');
    expect(splitLocaleFromPath('/zh/about/')).toEqual({ locale: 'zh', path: '/about/' });
  });

  test('getReservedRouteSegments = static set ∪ all configured locales (default included)', () => {
    const reserved = getReservedRouteSegments();
    for (const segment of RESERVED_ROUTE_SEGMENTS) {
      expect(reserved.has(segment)).toBe(true);
    }
    expect(reserved.has('en')).toBe(true);
    expect(reserved.has('zh')).toBe(true);
  });
});

describe('locale-code collision throws (strict build)', () => {
  test('series auto-path slug equal to a locale code throws', () => {
    expect(() => validateSeriesAutoPaths(['zh'])).toThrow(/locale prefix "\/zh"/);
    expect(() => validateSeriesAutoPaths(['en'])).toThrow(/locale prefix "\/en"/);
    expect(() => validateSeriesAutoPaths(['my-series'])).not.toThrow();
  });

  test('single-segment redirectFrom alias equal to a locale code throws', () => {
    const posts = [{ slug: 'moved-post', series: undefined, redirectFrom: ['/zh'] }];
    expect(() => collectSingleSegmentAliases(posts, new Set(getReservedRouteSegments()))).toThrow(
      /conflicts with an existing top-level route/
    );
  });

  test('config: posts.basePath equal to a locale code is rejected', () => {
    const bad = { ...siteConfig, posts: { ...siteConfig.posts, basePath: 'zh' } };
    expect(() => validateSiteConfig(bad)).toThrow(/posts\.basePath.*locale/);
  });

  test('config: series.customPaths value equal to a locale code is rejected', () => {
    const bad = {
      ...siteConfig,
      series: { ...siteConfig.series, customPaths: { ...siteConfig.series.customPaths, foo: 'zh' } },
    };
    expect(() => validateSiteConfig(bad)).toThrow(/customPaths.*locale/);
  });

  test('config: defaultLocale must be listed in locales', () => {
    const bad = { ...siteConfig, i18n: { ...siteConfig.i18n, defaultLocale: 'fr' } };
    expect(() => validateSiteConfig(bad)).toThrow(/defaultLocale "fr" must be listed/);
  });

  test('config: locale collisions are not enforced when i18n is disabled', () => {
    const disabled = {
      ...siteConfig,
      i18n: { ...siteConfig.i18n, enabled: false },
      posts: { ...siteConfig.posts, basePath: 'zh' },
    };
    expect(() => validateSiteConfig(disabled)).not.toThrow();
  });
});

describe('nextSwitchableLocale (safe cycling)', () => {
  const manifest = { zh: ['/about/'] };

  test('two locales cycle between each other when the non-default has content', () => {
    expect(nextSwitchableLocale('en', manifest, EN_DEFAULT)).toBe('zh');
    expect(nextSwitchableLocale('zh', manifest, EN_DEFAULT)).toBe('en');
  });

  test('empty non-default locales are skipped, never navigated into', () => {
    const threeLocales = { locales: ['en', 'zh', 'fr'], defaultLocale: 'en' };
    // fr has no manifest entries → cycling from zh skips fr and lands on en.
    expect(nextSwitchableLocale('zh', manifest, threeLocales)).toBe('en');
    // From en, zh (has content) wins over fr (empty).
    expect(nextSwitchableLocale('en', manifest, threeLocales)).toBe('zh');
    // From en with NO locale content anywhere → nothing to switch to.
    expect(nextSwitchableLocale('en', {}, threeLocales)).toBeNull();
  });

  test('the default locale is always reachable', () => {
    expect(nextSwitchableLocale('zh', {}, EN_DEFAULT)).toBe('en');
  });
});

describe('localeStickyHref (nav/footer chrome links)', () => {
  const manifest = { zh: ['/', '/posts/', '/about/'] };

  test('sticks to the locale when the target exists there', () => {
    expect(localeStickyHref('/posts', 'zh', manifest, EN_DEFAULT)).toBe('/zh/posts');
    expect(localeStickyHref('/about/', 'zh', manifest, EN_DEFAULT)).toBe('/zh/about/');
    expect(localeStickyHref('/', 'zh', manifest, EN_DEFAULT)).toBe('/zh/');
  });

  test('falls back to the unprefixed surface when the locale lacks the target', () => {
    expect(localeStickyHref('/archive', 'zh', manifest, EN_DEFAULT)).toBe('/archive');
    expect(localeStickyHref('/tags', 'zh', manifest, EN_DEFAULT)).toBe('/tags');
  });

  test('identity on the default locale; external and file hrefs pass through', () => {
    expect(localeStickyHref('/posts', 'en', manifest, EN_DEFAULT)).toBe('/posts');
    expect(localeStickyHref('https://example.com/x', 'zh', manifest, EN_DEFAULT)).toBe('https://example.com/x');
    expect(localeStickyHref('/feed.xml', 'zh', manifest, EN_DEFAULT)).toBe('/feed.xml');
  });

  test('query strings and fragments ride along on the pathname match', () => {
    expect(localeStickyHref('/about#team', 'zh', manifest, EN_DEFAULT)).toBe('/zh/about#team');
    expect(localeStickyHref('/posts?tag=x', 'zh', manifest, EN_DEFAULT)).toBe('/zh/posts?tag=x');
    expect(localeStickyHref('/archive#top', 'zh', manifest, EN_DEFAULT)).toBe('/archive#top');
  });
});
