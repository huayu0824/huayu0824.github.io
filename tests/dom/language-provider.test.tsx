import { describe, test, expect } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '@/components/LanguageProvider';
import { translations, type Language } from '@/i18n/translations';

/**
 * Consumer probe. Uses the `home` key: it is never overridden by
 * siteConfig.features.*.name (only series/books/flow/posts keys are), so the
 * assertions stay valid regardless of feature-name configuration.
 */
function Probe() {
  const { language, t, tWith, twinnedPaths } = useLanguage();
  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="home">{t('home')}</span>
      <span data-testid="page">{tWith('page_of_total', { page: 2, total: 5 })}</span>
      <span data-testid="twins">{Object.keys(twinnedPaths).join(',')}</span>
    </div>
  );
}

function renderProbe(props?: { locale?: Language; twinnedPaths?: Record<string, string[]> }) {
  return render(
    <LanguageProvider {...props}>
      <Probe />
    </LanguageProvider>,
  );
}

describe('LanguageProvider / useLanguage (URL-derived locale)', () => {
  test('no locale prop and no router pathname → default locale, synchronously', () => {
    renderProbe();
    // No hydration gate anymore: the very first render carries the final strings.
    expect(screen.getByTestId('language').textContent).toBe('en');
    expect(screen.getByTestId('home').textContent).toBe(translations.en.home);
  });

  test('explicit locale prop wins and serves its strings on the first render', () => {
    renderProbe({ locale: 'zh' });
    expect(screen.getByTestId('language').textContent).toBe('zh');
    expect(screen.getByTestId('home').textContent).toBe(translations.zh.home);
  });

  test('tWith() interpolates {params} into the translated string', () => {
    renderProbe();
    expect(screen.getByTestId('page').textContent).toBe('Page 2 of 5');
  });

  test('a locale with no translations table falls back to default strings', () => {
    renderProbe({ locale: 'fr' as Language });
    expect(screen.getByTestId('home').textContent).toBe(translations.en.home);
  });

  test('twinnedPaths defaults to empty and passes through when provided', () => {
    renderProbe();
    expect(screen.getByTestId('twins').textContent).toBe('');
    renderProbe({ twinnedPaths: { zh: ['/about/'] } });
    expect(screen.getAllByTestId('twins').at(-1)!.textContent).toBe('zh');
  });

  test('useLanguage outside a LanguageProvider throws', () => {
    expect(() => render(<Probe />)).toThrow('useLanguage must be used within a LanguageProvider');
  });

  test('syncs <html lang> to the rendered language', async () => {
    renderProbe({ locale: 'zh' });
    await waitFor(() => expect(document.documentElement.lang).toBe('zh'));
    renderProbe({ locale: 'en' });
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  });
});
