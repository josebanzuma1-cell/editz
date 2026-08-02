import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
// Slugs only — importing the full registry here would drag Zod, every
// `buildOps` and all the SEO copy into the edge bundle, on every request.
import { TOOL_SLUGS } from '@editz/tool-registry/slugs';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

const SLUGS = new Set(TOOL_SLUGS);

/** `/compress-video` and `/sw/compress-video` both name the same tool. */
function slugFromPathname(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  const first = segments[0];
  const candidate =
    first !== undefined && (routing.locales as readonly string[]).includes(first)
      ? segments[1]
      : first;

  return candidate !== undefined && SLUGS.has(candidate) ? candidate : null;
}

export default function middleware(request: NextRequest) {
  const response = intlMiddleware(request);

  // Cross-origin isolation is what makes SharedArrayBuffer — and therefore
  // multi-threaded ffmpeg.wasm — available. It also breaks every third-party
  // embed on the page, so it goes on tool routes only and nowhere else (§11).
  // Marketing pages, pricing and the legal pages stay embeddable.
  if (slugFromPathname(request.nextUrl.pathname)) {
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  }

  return response;
}

export const config = {
  // Everything except Next internals and files with an extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
