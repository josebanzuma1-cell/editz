import { NextResponse, type NextRequest } from 'next/server';
import { getLocalStorage } from '@/server/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Serves the local storage stand-in.
 *
 * This is what a presigned R2 URL points at when there are no R2 credentials.
 * It verifies the signature, the method, the expiry and the size cap — the
 * same things R2 would — because a development route that skips the checks
 * means the first real exercise of the signing path is in production.
 *
 * Returns 404 rather than 403 for everything: an endpoint that only exists in
 * development should not become an oracle that confirms which keys are real.
 */
async function storageOr404() {
  const storage = await getLocalStorage();
  return storage;
}

function signedParams(request: NextRequest) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  const method = url.searchParams.get('method');
  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig');
  const max = url.searchParams.get('max');

  if (!key || !sig || (method !== 'PUT' && method !== 'GET')) return null;
  return { key, method, exp, sig, maxBytes: max === null ? undefined : Number(max) };
}

export async function PUT(request: NextRequest) {
  const storage = await storageOr404();
  if (!storage) return new NextResponse(null, { status: 404 });

  const params = signedParams(request);
  if (!params || params.method !== 'PUT') return new NextResponse(null, { status: 404 });
  if (!storage.verify(params.key, 'PUT', params.exp, params.sig, params.maxBytes)) {
    return new NextResponse(null, { status: 403 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  // The cap was signed into the URL, so honouring it here is the point of
  // having signed it.
  if (params.maxBytes !== undefined && body.byteLength > params.maxBytes) {
    return NextResponse.json({ error: 'too-large' }, { status: 413 });
  }

  await storage.put(params.key, body, request.headers.get('content-type') ?? undefined);
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: NextRequest) {
  const storage = await storageOr404();
  if (!storage) return new NextResponse(null, { status: 404 });

  const params = signedParams(request);
  if (!params || params.method !== 'GET') return new NextResponse(null, { status: 404 });
  if (!storage.verify(params.key, 'GET', params.exp, params.sig, params.maxBytes)) {
    return new NextResponse(null, { status: 403 });
  }

  const object = await storage.get(params.key);
  if (!object) return new NextResponse(null, { status: 404 });

  return new NextResponse(object.body as BodyInit, {
    headers: {
      'content-type': object.contentType ?? 'application/octet-stream',
      'content-length': String(object.body.byteLength),
    },
  });
}
