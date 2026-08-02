import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export function SiteFooter() {
  const t = useTranslations('footer');

  return (
    <footer className="border-t border-black/8">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-10">
        {/* §11: the retention rule is stated plainly, in the footer of every
            page, not buried in a policy nobody opens. */}
        <p className="max-w-2xl text-sm leading-relaxed text-text-on-paper-muted">
          {t('retention')}
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-text-on-paper-muted">
          <Link href="/privacy" className="hover:text-text-on-paper">
            {t('privacy')}
          </Link>
          <Link href="/terms" className="hover:text-text-on-paper">
            {t('terms')}
          </Link>
          <span className="ml-auto tabular-nums">
            {t('rights', { year: new Date().getFullYear() })}
          </span>
        </div>
      </div>
    </footer>
  );
}
