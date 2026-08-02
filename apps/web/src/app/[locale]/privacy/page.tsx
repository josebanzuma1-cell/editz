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
  return { title: t('privacyTitle') };
}

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-14 leading-relaxed">
      <h1 className="text-display-l">{t('privacyTitle')}</h1>

      <p className="text-text-on-paper">
        Most Editz tools run entirely in your browser. When they do, your file is never
        sent to us. It is read from your device, worked on in the tab, and handed back.
        We do not receive it, we cannot see it, and there is nothing for us to delete.
      </p>
      <p className="text-text-on-paper">
        Some jobs cannot run in a browser — very large files, low-memory devices, and the
        subtitle and translation tools, which need models far too large to download. Those
        are uploaded. The tool page tells you before you start, and shows you the number of
        megabytes involved.
      </p>
      <p className="text-text-on-paper">
        Anything we do receive is deleted automatically within 24 hours, and you can delete
        it immediately from the download screen. We do not use your files to train anything.
        Transcription runs on our own servers rather than being passed to a third-party API.
      </p>

      <p className="text-sm text-text-on-paper-muted">
        This page will be replaced with a full policy before accounts and payments ship.
        What is written above is the intended behaviour and is what the product currently
        does.
      </p>
    </div>
  );
}
