import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TOOLS, getTool, relatedTools } from '@editz/tool-registry';
import { SITE_URL } from '@/lib/site';
import { t } from '@/lib/copy';
import { ToolJsonLd } from '@/components/seo/json-ld';
import { ToolWorkspace } from '@/components/tool/tool-workspace';

type Props = { params: Promise<{ slug: string }> };

/** Every tool page, generated from the registry. There is no hand-written
 *  route file for any tool and there never will be. */
export function generateStaticParams() {
  return TOOLS.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) return {};

  return {
    title: tool.seo.title,
    description: tool.seo.description,
    ...(tool.seo.keywords ? { keywords: tool.seo.keywords } : {}),
    alternates: { canonical: `/${slug}` },
    openGraph: {
      type: 'website',
      title: tool.seo.title,
      description: tool.seo.description,
      url: `${SITE_URL}/${slug}`,
    },
  };
}

export default async function ToolPage({ params }: Props) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();

  const related = relatedTools(slug);
  const isApp = tool.ui.surface === 'app';

  return (
    <>
      <ToolJsonLd tool={tool} url={`${SITE_URL}/${slug}`} />

      <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
        <header className="mb-8 space-y-3">
          <h1 className="text-display-m sm:text-display-l">{tool.seo.h1}</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-text-on-paper-muted">
            {tool.seo.description}
          </p>
        </header>

        {isApp ? (
          <AppNotice name={tool.name} />
        ) : (
          // Only plain values cross into the client. The manifest holds a Zod
          // schema and four functions; the browser imports it itself.
          <ToolWorkspace
            slug={tool.slug}
            category={tool.category}
            name={tool.name}
            accepts={tool.accepts}
            multiFile={tool.multiFile}
          />
        )}

        {/* Long-form copy sits below the tool, not above it. Someone who
            arrived to compress a video should not have to scroll past an
            essay to do it. */}
        <section className="mt-14 space-y-4">
          {tool.seo.intro.split('\n\n').map((paragraph) => (
            <p key={paragraph.slice(0, 40)} className="leading-relaxed text-text-on-paper">
              {paragraph}
            </p>
          ))}
        </section>

        <section className="mt-14">
          <h2 className="text-display-m mb-6">
            {t('tool.howTo', { name: tool.name.toLowerCase() })}
          </h2>
          <ol className="space-y-5">
            {tool.seo.steps.map((step, index) => (
              <li key={step} className="flex gap-4">
                <span className="label-instrument mt-1 shrink-0 text-signal tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="leading-relaxed text-text-on-paper">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14">
          <h2 className="text-display-m mb-6">{t('tool.faqTitle')}</h2>
          <dl className="divide-y divide-black/10 border-y border-black/10">
            {tool.seo.faq.map((entry) => (
              <div key={entry.q} className="py-5">
                <dt className="font-display font-semibold text-text-on-paper">{entry.q}</dt>
                <dd className="mt-2 leading-relaxed text-text-on-paper-muted">{entry.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {related.length > 0 ? (
          <section className="mt-14">
            <h2 className="text-display-m mb-6">{t('tool.relatedTitle')}</h2>
            <ul className="flex flex-wrap gap-2">
              {related.map((other) => (
                <li key={other.slug}>
                  <Link
                    href={`/${other.slug}`}
                    className="inline-block rounded-md border border-black/12 px-4 py-2 text-sm text-text-on-paper hover:border-text-on-paper"
                  >
                    {other.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}

/** The editor and the recorders are applications, not a file-in-file-out
 *  form, so their pages keep the SEO copy but do not pretend to have a
 *  parameter panel yet. */
function AppNotice({ name }: { name: string }) {
  return (
    <div data-surface="ink" className="rounded-xl border border-hairline px-6 py-10 text-center">
      <p className="font-display text-xl font-semibold tracking-tight text-text-on-ink">{name}</p>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-on-ink-muted">
        This one is an application rather than a single-shot tool. It arrives in a later
        release — the page, the copy and the search listing are live now so it is not a
        dead link when it does.
      </p>
    </div>
  );
}
