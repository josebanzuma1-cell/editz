import { NextResponse, type NextRequest } from 'next/server';
// Slugs only — importing the full registry here would drag Zod, every
// `buildOps` and all the SEO copy into the edge bundle, on every request.
import { TOOL_SLUGS } from '@editz/tool-registry/slugs';

const SLUGS = new Set(TOOL_SLUGS);

function isToolRoute(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];
  return segments.length === 1 && first !== undefined && SLUGS.has(first);
}

export default function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // Cross-origin isolation is what makes SharedArrayBuffer — and therefore
  // multi-threaded ffmpeg.wasm — available. It also breaks every third-party
  // embed on the page, so it goes on tool routes only and nowhere else (§11).
  // Marketing, pricing and the legal pages stay embeddable.
  if (isToolRoute(request.nextUrl.pathname)) {
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
