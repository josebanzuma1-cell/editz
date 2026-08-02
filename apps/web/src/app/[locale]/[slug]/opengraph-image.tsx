import { ImageResponse } from 'next/og';
import { TOOLS, getTool } from '@editz/tool-registry';
import { routing } from '@/i18n/routing';

export const alt = 'Editz';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => TOOLS.map((tool) => ({ locale, slug: tool.slug })));
}

/**
 * One OG image per tool, generated from the manifest. Deliberately typographic
 * and dark, matching the workspace rather than the marketing pages — the thing
 * being shared is a tool, and it should look like an instrument.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tool = getTool(slug);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#0F1115',
          padding: 72,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: '#FF6B35' }} />
          <div
            style={{
              color: '#9AA1AE',
              fontSize: 22,
              letterSpacing: 4,
              textTransform: 'uppercase',
            }}
          >
            Editz
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div
            style={{
              color: '#F2F3F5',
              fontSize: 88,
              fontWeight: 700,
              letterSpacing: -3,
              lineHeight: 1,
            }}
          >
            {tool?.seo.h1 ?? 'Editz'}
          </div>
          <div style={{ color: '#9AA1AE', fontSize: 30, lineHeight: 1.35, maxWidth: 900 }}>
            {tool?.seo.description ?? 'Edit video, audio and images in your browser.'}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            borderTop: '1px solid #262A33',
            paddingTop: 28,
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: '#FF6B35' }} />
          <div style={{ color: '#FF6B35', fontSize: 26, letterSpacing: 1 }}>
            {tool?.execution === 'server' || tool?.serverOnly
              ? 'Runs on our servers'
              : 'On your device · 0 MB uploaded'}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
