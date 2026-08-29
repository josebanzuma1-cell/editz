import Link from 'next/link';
import { t } from '@/lib/copy';

export function SiteHeader() {
  return (
    <header className="border-b border-black/8">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4">
        <Link href="/" className="font-display text-lg font-bold tracking-tight text-text-on-paper">
          {t('site.name')}
          <span className="ml-1 inline-block size-1.5 translate-y-[-0.35em] rounded-full bg-signal" />
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/tools"
            className="rounded-md px-3 py-2 text-text-on-paper-muted hover:text-text-on-paper"
          >
            {t('nav.tools')}
          </Link>
          <Link
            href="/video-editor"
            className="rounded-md px-3 py-2 text-text-on-paper-muted hover:text-text-on-paper"
          >
            {t('nav.editor')}
          </Link>
          <Link
            href="/pricing"
            className="rounded-md px-3 py-2 text-text-on-paper-muted hover:text-text-on-paper"
          >
            {t('nav.pricing')}
          </Link>
        </nav>
      </div>
    </header>
  );
}
