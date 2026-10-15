import { MetadataRoute } from 'next';
import { getAllPosts, getAllPages, getPostContentLocales, getPageContentLocales } from '@/lib/content/posts';
import { getAllFlows } from '@/lib/content/flows';
import { getAllNotes, getNoteContentLocales } from '@/lib/content/notes';
import { getAllBooks, getBookChapter } from '@/lib/content/books';
import { getAllSeries, getSeriesData } from '@/lib/content/series';
import { getAllAuthors, getAuthorSlug } from '@/lib/content/authors';
import { getAllTags } from '@/lib/content/discovery';
import { isFeatureEnabled } from '@/lib/features';
import {
  bookContentLocales,
  chapterContentLocales,
  contentSeoUrls,
  hasLocaleContent,
  seriesListingPrefixes,
} from '@/lib/locale-routes';
import { siteConfig } from '../../site.config';
import {
  getPostUrl,
  getBookUrl,
  getBookChapterUrl,
  getNonDefaultLocales,
  getPostsBasePath,
  getSeriesUrl,
  getSeriesListUrl,
  getStaticPageUrl,
  getNoteUrl,
  localizeUrl,
  withTrailingSlash,
} from '@/lib/urls';

export const dynamic = 'force-static';

const DEFAULT_LOCALE = siteConfig.i18n.defaultLocale;

/**
 * `alternates.languages` spread for an entity that exists in ≥2 locale trees
 * (same URL set as contentSeoUrls, x-default included); empty otherwise.
 * `entityUrl` may carry a locale prefix — the set is derived from the
 * unprefixed form, so a twin's default and locale entries get identical blocks.
 */
function languagesFor(
  entityUrl: string,
  locales: string[],
): Pick<MetadataRoute.Sitemap[number], 'alternates'> | Record<string, never> {
  const { languageAlternates } = contentSeoUrls(entityUrl, locales);
  return languageAlternates ? { alternates: { languages: languageAlternates } } : {};
}

/** Locales whose tree holds a series of this slug (default first). */
function seriesContentLocales(seriesSlug: string): string[] {
  return [DEFAULT_LOCALE, ...getNonDefaultLocales()].filter(
    (locale) => Object.hasOwn(getAllSeries(locale), seriesSlug)
  );
}

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();
  const pages = getAllPages();
  const baseUrl = siteConfig.baseUrl;

  // Feature-aware: the routes for a disabled feature call notFound(), so their
  // URLs must not be advertised. posts is the base surface and always present.
  const seriesEnabled = isFeatureEnabled('series');
  const booksEnabled = isFeatureEnabled('books');
  const flowEnabled = isFeatureEnabled('flow'); // gates both flows and notes

  const postUrls = posts.map((post) => ({
    url: `${baseUrl}${getPostUrl(post)}`,
    lastModified: post.date,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
    ...languagesFor(getPostUrl(post), getPostContentLocales(post)),
  }));

  const pageUrls = pages.map((page) => ({
    url: `${baseUrl}/${page.slug}`,
    lastModified: page.date, // Pages might not have date, fallback?
    // markdown.ts logic provides default date if missing.
    changeFrequency: 'yearly' as const,
    priority: 0.8,
    ...languagesFor(getStaticPageUrl(page.slug), getPageContentLocales(page)),
  }));

  // Series — list page + each series detail
  const seriesEntry = getAllSeries();
  const seriesUrls = seriesEnabled
    ? Object.entries(seriesEntry).map(([slug, seriesPosts]) => ({
        url: `${baseUrl}${getSeriesUrl(slug)}`,
        // getAllSeries can include empty series dirs; reduce would then yield ''
        // (an invalid date). Fall back to the series index date, else omit.
        lastModified:
          seriesPosts.reduce((latest, p) => (p.date > latest ? p.date : latest), '') ||
          getSeriesData(slug)?.date ||
          undefined,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
        ...languagesFor(getSeriesUrl(slug), seriesContentLocales(slug)),
      }))
    : [];

  // Books — list page + each book and its chapters
  const bookUrls = booksEnabled
    ? getAllBooks().flatMap((book) => [
        {
          url: `${baseUrl}${getBookUrl(book.slug)}`,
          lastModified: book.date,
          changeFrequency: 'monthly' as const,
          priority: 0.8,
          ...languagesFor(getBookUrl(book.slug), bookContentLocales(book.slug)),
        },
        ...book.chapters.map((ch) => ({
          url: `${baseUrl}${getBookChapterUrl(book.slug, ch.id)}`,
          lastModified: book.date,
          changeFrequency: 'monthly' as const,
          priority: 0.7,
          ...languagesFor(getBookChapterUrl(book.slug, ch.id), chapterContentLocales(book.slug, ch.id)),
        })),
      ])
    : [];

  // Notes — gated with flows under the flow feature
  const noteUrls = flowEnabled
    ? getAllNotes().map((note) => ({
        url: `${baseUrl}${getNoteUrl(note.slug)}`,
        lastModified: note.date,
        changeFrequency: 'monthly' as const,
        priority: 0.5,
        ...languagesFor(getNoteUrl(note.slug), getNoteContentLocales(note)),
      }))
    : [];

  // Flows — detail entries plus year/month listing pages
  const flows = flowEnabled ? getAllFlows() : [];
  const flowUrls = flows.map((flow) => ({
    url: `${baseUrl}/flows/${flow.slug}`,
    lastModified: flow.date,
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));

  const flowYears = new Set<string>();
  const flowMonths = new Set<string>();
  flows.forEach(flow => {
    const [year, month] = flow.slug.split('/');
    flowYears.add(year);
    flowMonths.add(`${year}/${month}`);
  });

  const flowYearUrls = Array.from(flowYears).map(year => ({
    url: `${baseUrl}/flows/${year}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  const flowMonthUrls = Array.from(flowMonths).map(ym => ({
    url: `${baseUrl}/flows/${ym}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  // Authors — canonical slug URL only (no /authors index route exists)
  const authorUrls = Object.keys(getAllAuthors()).map((name) => ({
    url: `${baseUrl}/authors/${getAuthorSlug(name)}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.5,
  }));

  // Locale-tree mirror: the /<locale>/… surface, advertised alongside the
  // default tree. Gates match the locale route providers exactly (sparse
  // trees advertise only what they hold). Twin entries carry the same
  // alternates.languages block as their unprefixed counterpart (both sides
  // point hreflang at each other); locale-original entries stay plain.
  const localeUrls: MetadataRoute.Sitemap = getNonDefaultLocales().flatMap((locale) => {
    const entries: MetadataRoute.Sitemap = [];

    // Section listings — same hasLocaleContent gates as localeHome/SecondLevel params.
    if (hasLocaleContent(locale, 'any')) {
      entries.push({
        url: `${baseUrl}${localizeUrl('/', locale)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.8,
      });
    }
    if (hasLocaleContent(locale, 'posts')) {
      entries.push({
        url: `${baseUrl}${localizeUrl(`/${getPostsBasePath()}`, locale)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.8,
      });
    }
    if (seriesEnabled && hasLocaleContent(locale, 'series')) {
      entries.push({
        url: `${baseUrl}${localizeUrl(getSeriesListUrl(), locale)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.8,
      });
    }
    if (booksEnabled && hasLocaleContent(locale, 'books')) {
      entries.push({
        url: `${baseUrl}${localizeUrl('/books', locale)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.8,
      });
    }
    if (flowEnabled && hasLocaleContent(locale, 'notes')) {
      entries.push({
        url: `${baseUrl}${localizeUrl('/notes', locale)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }

    // Static pages of the locale tree.
    for (const page of getAllPages(locale)) {
      entries.push({
        url: `${baseUrl}${localizeUrl(getStaticPageUrl(page.slug), locale)}`,
        lastModified: page.date,
        changeFrequency: 'yearly',
        priority: 0.8,
        ...languagesFor(getStaticPageUrl(page.slug), getPageContentLocales(page)),
      });
    }

    // Posts — getPostUrl is entity-carried, so the URL is already prefixed.
    for (const post of getAllPosts(locale)) {
      entries.push({
        url: `${baseUrl}${getPostUrl(post)}`,
        lastModified: post.date,
        changeFrequency: 'monthly',
        priority: 0.7,
        ...languagesFor(getPostUrl(post), getPostContentLocales(post)),
      });
    }

    // Series landings + prefix listings of the locale tree.
    if (seriesEnabled) {
      for (const [slug, seriesPosts] of Object.entries(getAllSeries(locale))) {
        entries.push({
          url: `${baseUrl}${localizeUrl(getSeriesUrl(slug), locale)}`,
          lastModified:
            seriesPosts.reduce((latest, p) => (p.date > latest ? p.date : latest), '') ||
            getSeriesData(slug, locale)?.date ||
            undefined,
          changeFrequency: 'monthly',
          priority: 0.7,
          ...languagesFor(getSeriesUrl(slug), seriesContentLocales(slug)),
        });
      }
      for (const { prefix } of seriesListingPrefixes(locale)) {
        entries.push({
          url: `${baseUrl}${localizeUrl(`/${prefix}`, locale)}`,
          lastModified: new Date(),
          changeFrequency: 'weekly',
          priority: 0.7,
        });
      }
    }

    // Books and chapters of the locale tree.
    if (booksEnabled) {
      for (const book of getAllBooks(locale)) {
        entries.push({
          url: `${baseUrl}${localizeUrl(getBookUrl(book.slug), locale)}`,
          lastModified: book.date,
          changeFrequency: 'monthly',
          priority: 0.8,
          ...languagesFor(getBookUrl(book.slug), bookContentLocales(book.slug)),
        });
        for (const ch of book.chapters) {
          if (getBookChapter(book.slug, ch.id, locale) === null) continue;
          entries.push({
            url: `${baseUrl}${localizeUrl(getBookChapterUrl(book.slug, ch.id), locale)}`,
            lastModified: book.date,
            changeFrequency: 'monthly',
            priority: 0.7,
            ...languagesFor(getBookChapterUrl(book.slug, ch.id), chapterContentLocales(book.slug, ch.id)),
          });
        }
      }
    }

    // Notes of the locale tree.
    if (flowEnabled) {
      for (const note of getAllNotes(locale)) {
        entries.push({
          url: `${baseUrl}${localizeUrl(getNoteUrl(note.slug), locale)}`,
          lastModified: note.date,
          changeFrequency: 'monthly',
          priority: 0.5,
          ...languagesFor(getNoteUrl(note.slug), getNoteContentLocales(note)),
        });
      }
    }

    return entries;
  });

  // Tag detail pages. Encode the lowercased tag exactly as the Tag component's
  // href does, so special-character tags (spaces, `c#`, `a/b`) stay valid URLs.
  const tagUrls = Object.keys(getAllTags()).map((tag) => ({
    url: `${baseUrl}/tags/${encodeURIComponent(tag.toLowerCase())}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.5,
  }));

  const entries: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${baseUrl}/archive`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/tags`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    ...(seriesEnabled
      ? [{
          url: `${baseUrl}${getSeriesListUrl()}`,
          lastModified: new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.8,
        }]
      : []),
    ...(booksEnabled
      ? [{
          url: `${baseUrl}/books`,
          lastModified: new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.8,
        }]
      : []),
    ...(flowEnabled
      ? [
          {
            url: `${baseUrl}/flows`,
            lastModified: new Date(),
            changeFrequency: 'daily' as const,
            priority: 0.8,
          },
          {
            url: `${baseUrl}/notes`,
            lastModified: new Date(),
            changeFrequency: 'weekly' as const,
            priority: 0.7,
          },
        ]
      : []),
    ...pageUrls,
    ...postUrls,
    ...seriesUrls,
    ...bookUrls,
    ...noteUrls,
    ...authorUrls,
    ...tagUrls,
    ...flowYearUrls,
    ...flowMonthUrls,
    ...flowUrls,
    // Appended last so every existing default-tree entry stays byte-identical.
    ...localeUrls,
  ];

  // Advertise the canonical trailing-slash form: with trailingSlash: true the
  // export serves /path/index.html, so the bare /path variant is a redirect
  // hop for crawlers on most static hosts.
  return entries.map((entry) => ({ ...entry, url: withTrailingSlash(entry.url) }));
}
