import type { MetadataRoute } from 'next';
import { TOOLS } from '@editz/tool-registry';
import { SITE_URL } from '@/lib/site';

const STATIC_PATHS = ['', '/tools', '/pricing', '/privacy', '/terms'];

/**
 * Generated from the registry (§9). A tool that exists is in the sitemap by
 * construction — there is no list to forget to update.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const staticEntries = STATIC_PATHS.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: 'monthly' as const,
    priority: path === '' ? 1 : 0.6,
  }));

  const toolEntries = TOOLS.map((tool) => ({
    url: `${SITE_URL}/${tool.slug}`,
    changeFrequency: 'monthly' as const,
    // Tool pages are the point of the site; they outrank the marketing pages.
    priority: 0.8,
  }));

  return [...staticEntries, ...toolEntries];
}
