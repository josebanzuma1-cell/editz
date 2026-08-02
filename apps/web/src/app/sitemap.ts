import type { MetadataRoute } from 'next';
import { TOOLS } from '@editz/tool-registry';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site';

const STATIC_PATHS = ['', '/tools', '/pricing', '/privacy', '/terms'];

const url = (locale: string, path: string) =>
  locale === routing.defaultLocale ? `${SITE_URL}${path}` : `${SITE_URL}/${locale}${path}`;

/**
 * Generated from the registry (§9). A tool that exists is in the sitemap by
 * construction — there is no list to forget to update.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = (path: string) =>
    Object.fromEntries(routing.locales.map((locale) => [locale, url(locale, path)]));

  const staticEntries = STATIC_PATHS.map((path) => ({
    url: url(routing.defaultLocale, path),
    changeFrequency: 'monthly' as const,
    priority: path === '' ? 1 : 0.6,
    alternates: { languages: languages(path) },
  }));

  const toolEntries = TOOLS.map((tool) => ({
    url: url(routing.defaultLocale, `/${tool.slug}`),
    changeFrequency: 'monthly' as const,
    // Tool pages are the point of the site; they outrank the marketing pages.
    priority: 0.8,
    alternates: { languages: languages(`/${tool.slug}`) },
  }));

  return [...staticEntries, ...toolEntries];
}
