import { isFeatureEnabled } from '@/lib/features';
import { siteConfig } from '../../../site.config';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createListingMetadata } from '@/lib/metadata';
import NotesIndexBody from '@/components/page-bodies/NotesIndexBody';

const DEFAULT_LOCALE = siteConfig.i18n.defaultLocale;

export const metadata: Metadata = createListingMetadata({
  locale: DEFAULT_LOCALE,
  titleKey: 'notes',
  description: 'Knowledge base notes.',
});

export default function NotesPage() {
  if (!isFeatureEnabled('flow')) notFound();
  return <NotesIndexBody locale={DEFAULT_LOCALE} page={1} />;
}
