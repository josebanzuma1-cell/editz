import Link from 'next/link';
import { TOOLS, toolsByCategory } from '@editz/tool-registry';
import { t } from '@/lib/copy';
import { ToolGrid } from '@/components/marketing/tool-grid';

export default function HomePage() {
  // The most-searched tools first. Everything else is one click away.
  const featured = [
    ...toolsByCategory('edit').slice(0, 4),
    ...toolsByCategory('image').slice(0, 3),
    ...toolsByCategory('convert').slice(0, 2),
  ];

  const localCount = TOOLS.filter((tool) => tool.execution !== 'server' && !tool.serverOnly).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:py-20">
      <section className="max-w-3xl">
        <h1 className="text-display-l sm:text-display-xl">{t('home.title')}</h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-text-on-paper-muted">
          {t('home.subtitle')}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/tools"
            className="inline-flex h-12 items-center rounded-md bg-signal px-6 font-medium text-ink"
          >
            {t('home.browseTools')}
          </Link>
          <Link
            href="/video-editor"
            className="inline-flex h-12 items-center rounded-md border border-black/15 px-6 font-medium text-text-on-paper hover:border-text-on-paper"
          >
            {t('home.openEditor')}
          </Link>
        </div>
      </section>

      {/* The pitch, stated once and plainly. No gradient mesh, no floating
          device mockup — the claim is the interesting part (§10). */}
      <section data-surface="ink" className="mt-16 rounded-xl border border-hairline p-6 sm:p-10">
        <div className="grid gap-8 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="max-w-2xl space-y-4">
            <h2 className="text-display-m text-text-on-ink">{t('home.pitchTitle')}</h2>
            <p className="leading-relaxed text-text-on-ink-muted">{t('home.pitchBody')}</p>
          </div>
          <div className="flex gap-10">
            <div className="space-y-1.5">
              <span className="label-instrument block text-text-on-ink-faint">
                {t('tools.runsLocally')}
              </span>
              <span className="block font-display text-4xl font-bold tabular-nums text-signal">
                {localCount}
              </span>
            </div>
            <div className="space-y-1.5">
              <span className="label-instrument block text-text-on-ink-faint">
                {t('tools.indexTitle')}
              </span>
              <span className="block font-display text-4xl font-bold tabular-nums text-text-on-ink">
                {TOOLS.length}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-16">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-display-m">{t('tools.indexTitle')}</h2>
          <Link href="/tools" className="text-sm text-text-on-paper-muted hover:text-text-on-paper">
            {t('tools.count', { count: TOOLS.length })} →
          </Link>
        </div>
        <ToolGrid tools={featured} />
      </section>
    </div>
  );
}
