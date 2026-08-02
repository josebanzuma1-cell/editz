/**
 * Where the ffmpeg.wasm core comes from, and why it is fetched this way.
 *
 * Two constraints shape all of this, and neither is negotiable:
 *
 * 1. **Self-hosted, not a CDN.** Tool routes send `Cross-Origin-Embedder-Policy:
 *    require-corp` because multi-threaded wasm needs cross-origin isolation.
 *    Under that header the browser refuses any cross-origin subresource that
 *    does not send `Cross-Origin-Resource-Policy` back — which unpkg and
 *    jsDelivr do not. Loading the core from a CDN does not merely leak a
 *    dependency to a third party; it does not work at all.
 *
 * 2. **Cached forever, fetched once.** The core is around 30MB. On the
 *    connections this product is built for that is a genuine cost, and paying
 *    it twice is indefensible. It goes in the Cache API on first use and is
 *    read from there on every visit after, across sessions.
 *
 * The fetch is also the one moment where we are spending the user's data
 * without them having chosen to, so it is deliberately deferred until they
 * have picked a file — never on page load, and never on a landing page nobody
 * runs a job on (§9).
 */

/** Bump when the core version changes; the old entry is then evicted. */
const CACHE_NAME = 'editz-ffmpeg-core-v1';

export interface CoreSource {
  coreURL: string;
  wasmURL: string;
  workerURL: string;
}

/** Served from `public/ffmpeg/`, populated by `scripts/copy-ffmpeg-core.mjs`. */
const DEFAULT_BASE = '/ffmpeg';

export interface CoreLoadProgress {
  /** Bytes pulled over the network so far. Zero for a cache hit. */
  loadedBytes: number;
  totalBytes: number | null;
  fromCache: boolean;
}

/**
 * Fetches a core asset, preferring the cache, and hands back a blob URL.
 *
 * Blob URLs rather than the original paths because ffmpeg.wasm hands these to
 * `new Worker()` and `importScripts`, and a blob URL sidesteps the assorted
 * origin rules that otherwise bite under cross-origin isolation.
 */
async function loadAsset(
  url: string,
  mimeType: string,
  onProgress?: (bytes: number, total: number | null, fromCache: boolean) => void,
): Promise<string> {
  const cache = await openCache();

  const hit = await cache?.match(url);
  if (hit) {
    const blob = await hit.blob();
    onProgress?.(0, blob.size, true);
    return URL.createObjectURL(new Blob([blob], { type: mimeType }));
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ffmpeg core: ${url} responded ${response.status}`);
  }

  // Clone before reading: the cache needs an unconsumed body.
  if (cache) {
    try {
      await cache.put(url, response.clone());
    } catch {
      // A full or unavailable cache is a slow next visit, not a failure now.
    }
  }

  const total = Number(response.headers.get('content-length')) || null;
  const buffer = await response.arrayBuffer();
  onProgress?.(buffer.byteLength, total, false);
  return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // Private browsing in some engines rejects this outright.
    return null;
  }
}

export async function resolveCore(
  base: string = DEFAULT_BASE,
  onProgress?: (progress: CoreLoadProgress) => void,
): Promise<CoreSource> {
  let loaded = 0;
  let total = 0;
  let allCached = true;

  const report = (bytes: number, assetTotal: number | null, fromCache: boolean) => {
    loaded += bytes;
    total += assetTotal ?? 0;
    if (!fromCache) allCached = false;
    onProgress?.({ loadedBytes: loaded, totalBytes: total || null, fromCache: allCached });
  };

  const [coreURL, wasmURL, workerURL] = await Promise.all([
    loadAsset(`${base}/ffmpeg-core.js`, 'text/javascript', report),
    loadAsset(`${base}/ffmpeg-core.wasm`, 'application/wasm', report),
    loadAsset(`${base}/ffmpeg-core.worker.js`, 'text/javascript', report),
  ]);

  return { coreURL, wasmURL, workerURL };
}

/** True when the core is already local, so the UI can say "ready" rather than
 *  warning about a 30MB download it is not about to make. */
export async function isCoreCached(base: string = DEFAULT_BASE): Promise<boolean> {
  const cache = await openCache();
  if (!cache) return false;
  const entries = await Promise.all([
    cache.match(`${base}/ffmpeg-core.js`),
    cache.match(`${base}/ffmpeg-core.wasm`),
    cache.match(`${base}/ffmpeg-core.worker.js`),
  ]);
  return entries.every(Boolean);
}

export function releaseCore(source: CoreSource): void {
  for (const url of Object.values(source)) URL.revokeObjectURL(url);
}
