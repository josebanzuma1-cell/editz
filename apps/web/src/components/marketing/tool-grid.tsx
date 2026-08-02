import type { ReactNode } from 'react';
import type { AnyToolManifest } from '@editz/tool-registry';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * The tool grid. Plain, dense and fast, per §10 — no cards that lift, no
 * gradient borders, no icon that animates on hover. It is a list of places to
 * go, and its only job is to get out of the way.
 */
export function ToolGrid({ tools }: { tools: readonly AnyToolManifest[] }) {
  return (
    <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-black/10 bg-black/10 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((tool) => (
        <ToolCard key={tool.slug} tool={tool} />
      ))}
    </ul>
  );
}

function ToolCard({ tool }: { tool: AnyToolManifest }) {
  const t = useTranslations('tools');
  const runsLocally = tool.execution === 'client';
  const runsOnServer = tool.execution === 'server' || tool.serverOnly === true;

  return (
    <li className="bg-paper">
      <Link
        href={`/${tool.slug}`}
        className="flex h-full flex-col gap-2 p-5 transition-colors hover:bg-paper-sunken"
      >
        <span className="font-display text-base font-semibold tracking-tight text-text-on-paper">
          {tool.name}
        </span>
        <span className="line-clamp-2 text-sm leading-snug text-text-on-paper-muted">
          {tool.seo.description}
        </span>
        <span className="mt-auto flex items-center gap-2 pt-2">
          {runsLocally ? <Tag>{t('runsLocally')}</Tag> : null}
          {runsOnServer ? <Tag>{t('runsOnServer')}</Tag> : null}
          {tool.category === 'ai' ? <Tag accent>{t('pro')}</Tag> : null}
        </span>
      </Link>
    </li>
  );
}

function Tag({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={
        accent
          ? 'label-instrument rounded-sm bg-signal px-1.5 py-0.5 text-ink'
          : 'label-instrument rounded-sm border border-black/12 px-1.5 py-0.5 text-text-on-paper-muted'
      }
    >
      {children}
    </span>
  );
}
