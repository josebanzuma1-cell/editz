import type { AnyToolManifest } from '@editz/tool-registry';
import { SITE_URL } from '@/lib/site';

/**
 * Structured data for a tool page (§9). All three blocks are generated from
 * the manifest, so a tool cannot ship a landing page whose structured data
 * disagrees with the copy on it.
 */
export function ToolJsonLd({ tool, url }: { tool: AnyToolManifest; url: string }) {
  const graph = [
    {
      '@type': 'SoftwareApplication',
      '@id': `${url}#app`,
      name: tool.name,
      url,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any — runs in a web browser',
      description: tool.seo.description,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      publisher: { '@id': `${SITE_URL}#org` },
    },
    {
      '@type': 'HowTo',
      '@id': `${url}#howto`,
      name: tool.seo.h1,
      description: tool.seo.description,
      totalTime: 'PT2M',
      step: tool.seo.steps.map((step, index) => ({
        '@type': 'HowToStep',
        position: index + 1,
        name: step.split('.')[0],
        text: step,
      })),
    },
    {
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: tool.seo.faq.map((entry) => ({
        '@type': 'Question',
        name: entry.q,
        acceptedAnswer: { '@type': 'Answer', text: entry.a },
      })),
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}#org`,
      name: 'Editz',
      url: SITE_URL,
    },
  ];

  return <JsonLd data={{ '@context': 'https://schema.org', '@graph': graph }} />;
}

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // Serialised from our own manifests, never from user input. The `<`
      // escape guards against a future manifest containing markup anyway.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
