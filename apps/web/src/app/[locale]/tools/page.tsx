import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CATEGORY_ORDER, toolsByCategory } from '@editz/tool-registry';
import { routing } from '@/i18n/routing';
import { ToolGrid } from '@/components/marketing/tool-grid';

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'tools' });
  return {
    title: t('indexTitle'),
    description: t('indexDescription'),
    alternates: { canonical: locale === routing.defaultLocale ? '/tools' : `/${locale}/tools` },
  };
}

export default async function ToolsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('tools');
  const categories = await getTranslations('categories');

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <header className="mb-10 space-y-3">
        <h1 className="text-display-l">{t('indexTitle')}</h1>
        <p className="max-w-2xl text-lg text-text-on-paper-muted">{t('indexDescription')}</p>
      </header>

      <div className="space-y-12">
        {CATEGORY_ORDER.map((category) => {
          const tools = toolsByCategory(category);
          if (tools.length === 0) return null;
          return (
            <section key={category}>
              <div className="mb-4 flex items-baseline gap-3">
                <h2 className="text-display-m">{categories(category)}</h2>
                <span className="label-instrument text-text-on-paper-muted">
                  {t('count', { count: tools.length })}
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
