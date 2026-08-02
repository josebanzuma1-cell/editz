import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { FREE_FILE_LIMIT_BYTES, PRO_FILE_LIMIT_BYTES } from '@/lib/site';
import { formatBytes } from '@/lib/format';

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricing' });
  return { title: t('title'), description: t('subtitle') };
}

export default async function PricingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pricing');
  const f = await getTranslations('pricing.features');

  const free = [
    f('fileSize', { size: formatBytes(FREE_FILE_LIMIT_BYTES, locale) }),
    f('watermark'),
    f('noAi'),
    f('standardQueue'),
    f('retention'),
  ];

  const pro = [
    f('fileSize', { size: formatBytes(PRO_FILE_LIMIT_BYTES, locale) }),
    f('noWatermark'),
    f('ai'),
    f('export4k'),
    f('projects'),
    f('queue'),
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-14">
      <header className="mb-10 space-y-3">
        <h1 className="text-display-l">{t('title')}</h1>
        <p className="max-w-2xl text-lg text-text-on-paper-muted">{t('subtitle')}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Plan name={t('freeName')} features={free} />
        <Plan name={t('proName')} features={pro} accent cta={t('cta')} />
      </div>
    </div>
  );
}

function Plan({
  name,
  features,
  accent = false,
  cta,
}: {
  name: string;
  features: string[];
  accent?: boolean;
  cta?: string;
}) {
  return (
    <section
      {...(accent ? { 'data-surface': 'ink' } : {})}
      className={
        accent
          ? 'rounded-xl border border-hairline p-6'
          : 'rounded-xl border border-black/10 bg-paper p-6'
      }
    >
      <h2 className={accent ? 'text-display-m text-text-on-ink' : 'text-display-m'}>{name}</h2>
      <ul className="mt-6 space-y-3 text-sm">
        {features.map((feature) => (
          <li
            key={feature}
            className={accent ? 'text-text-on-ink-muted' : 'text-text-on-paper-muted'}
          >
            {feature}
          </li>
        ))}
      </ul>
      {cta ? <p className="mt-8 text-sm text-signal">{cta}</p> : null}
    </section>
  );
}
