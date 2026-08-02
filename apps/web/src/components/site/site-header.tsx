import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function SiteHeader() {
  const t = useTranslations('nav');
  const site = useTranslations('site');

  return (
    <header className="border-b border-black/8">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4">
        <Link
          href="/"
          className="font-display text-lg font-bold tracking-tight text-text-on-paper"
        >
          {site('name')}
          <span className="ml-1 inline-block size-1.5 translate-y-[-0.35em] rounded-full bg-signal" />
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/tools"
            className="rounded-md px-3 py-2 text-text-on-paper-muted hover:text-text-on-paper"
          >
            {t('tools')}
          </Link>
          <Link
            href="/video-editor"
            className="rounded-md px-3 py-2 text-text-on-paper-muted hover:text-text-on-paper"
          >
            {t('editor')}
          </Link>
          <Link
            href="/pricing"
            className="rounded-md px-3 py-2 text-text-on-paper-muted hover:text-text-on-paper"
          >
            {t('pricing')}
          </Link>
        </nav>
      </div>
    </header>
  );
}
