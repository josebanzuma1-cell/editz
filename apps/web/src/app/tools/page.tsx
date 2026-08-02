import type { Metadata } from 'next';
import { CATEGORY_ORDER, toolsByCategory } from '@editz/tool-registry';
import { t, tDynamic } from '@/lib/copy';
import { ToolGrid } from '@/components/marketing/tool-grid';

export const metadata: Metadata = {
  title: t('tools.indexTitle'),
  description: t('tools.indexDescription'),
  alternates: { canonical: '/tools' },
};

export default function ToolsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <header className="mb-10 space-y-3">
        <h1 className="text-display-l">{t('tools.indexTitle')}</h1>
        <p className="max-w-2xl text-lg text-text-on-paper-muted">{t('tools.indexDescription')}</p>
      </header>

      <div className="space-y-12">
        {CATEGORY_ORDER.map((category) => {
          const tools = toolsByCategory(category);
          if (tools.length === 0) return null;
          return (
            <section key={category}>
              <div className="mb-4 flex items-baseline gap-3">
                <h2 className="text-display-m">{tDynamic(`categories.${category}`)}</h2>
                <span className="label-instrument text-text-on-paper-muted">
                  {t('tools.count', { count: tools.length })}
                </span>
              </div>
              <ToolGrid tools={tools} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
