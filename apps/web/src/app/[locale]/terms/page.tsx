import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });
  return { title: t('termsTitle') };
}

export default async function TermsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-14 leading-relaxed">
      <h1 className="text-display-l">{t('termsTitle')}</h1>

      <p className="text-text-on-paper">
        Editz is provided as it is. Use it for anything you have the right to use — what
        you make with it is yours, including commercially.
      </p>
      <p className="text-text-on-paper">
        Do not use it to process material you do not have the right to process. Files sent
        to our servers are deleted within 24 hours and are not retained for any other
        purpose.
      </p>

      <p className="text-sm text-text-on-paper-muted">
        Full terms will be published before accounts and payments ship.
      </p>
    </div>
  );
}
