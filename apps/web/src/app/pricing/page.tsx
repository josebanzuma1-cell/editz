import type { Metadata } from 'next';
import { FREE_FILE_LIMIT_BYTES, PRO_FILE_LIMIT_BYTES } from '@/lib/site';
import { formatBytes } from '@/lib/format';
import { t } from '@/lib/copy';

export const metadata: Metadata = {
  title: t('pricing.title'),
  description: t('pricing.subtitle'),
  alternates: { canonical: '/pricing' },
};

export default function PricingPage() {
  const free = [
    t('pricing.features.fileSize', { size: formatBytes(FREE_FILE_LIMIT_BYTES) }),
    t('pricing.features.watermark'),
    t('pricing.features.noAi'),
    t('pricing.features.standardQueue'),
    t('pricing.features.retention'),
  ];

  const pro = [
    t('pricing.features.fileSize', { size: formatBytes(PRO_FILE_LIMIT_BYTES) }),
    t('pricing.features.noWatermark'),
    t('pricing.features.ai'),
    t('pricing.features.export4k'),
    t('pricing.features.projects'),
    t('pricing.features.queue'),
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-14">
      <header className="mb-10 space-y-3">
        <h1 className="text-display-l">{t('pricing.title')}</h1>
        <p className="max-w-2xl text-lg text-text-on-paper-muted">{t('pricing.subtitle')}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Plan name={t('pricing.freeName')} features={free} />
        <Plan name={t('pricing.proName')} features={pro} accent cta={t('pricing.cta')} />
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
