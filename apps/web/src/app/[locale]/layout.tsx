import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Inter_Tight, Space_Grotesk } from 'next/font/google';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site';
import { SiteHeader } from '@/components/site/site-header';
import { SiteFooter } from '@/components/site/site-footer';
import '../globals.css';

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display-src',
  display: 'swap',
  weight: ['500', '600', '700'],
});

const body = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-body-src',
  display: 'swap',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'site' });

  return {
    metadataBase: new URL(SITE_URL),
    title: { default: `${t('name')} — ${t('tagline')}`, template: `%s | ${t('name')}` },
    description: t('tagline'),
    applicationName: t('name'),
    alternates: {
      canonical: '/',
      languages: Object.fromEntries(routing.locales.map((l) => [l, l === 'en' ? '/' : `/${l}`])),
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Required for the whole tree to render statically rather than per request.
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'nav' });

  return (
    <html lang={locale} className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only rounded-md bg-signal px-4 py-2 text-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider>
          <div className="flex min-h-dvh flex-col">
            <SiteHeader />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter />
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
