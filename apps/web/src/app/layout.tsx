import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter_Tight, Space_Grotesk } from 'next/font/google';
import { SITE_URL } from '@/lib/site';
import { t } from '@/lib/copy';
import { SiteHeader } from '@/components/site/site-header';
import { SiteFooter } from '@/components/site/site-footer';
import './globals.css';

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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${t('site.name')} — ${t('site.tagline')}`,
    template: `%s | ${t('site.name')}`,
  },
  description: t('site.tagline'),
  applicationName: t('site.name'),
  alternates: { canonical: '/' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only rounded-md bg-signal px-4 py-2 text-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          {t('nav.skipToContent')}
        </a>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
