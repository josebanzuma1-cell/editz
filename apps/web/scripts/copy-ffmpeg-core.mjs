/**
 * Copies the ffmpeg.wasm core into `public/ffmpeg/`.
 *
 * It has to be same-origin. Tool routes send `Cross-Origin-Embedder-Policy:
 * require-corp` so that multi-threaded wasm can use SharedArrayBuffer, and
 * under that header the browser blocks any cross-origin subresource whose
 * server does not send `Cross-Origin-Resource-Policy` — which unpkg and
 * jsDelivr do not. Serving the core from a CDN is not a trade-off here; it
 * simply does not load.
 *
 * Runs before `dev` and `build`. Skips quietly when the files are already in
 * place, and fails loudly when the package is missing, because a silently
 * absent core turns into a 404 at the moment a user picks a file.
 */
import { createRequire } from 'node:module';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ASSETS = ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js'];
const target = join(process.cwd(), 'public', 'ffmpeg');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds a package's root directory.
 *
 * Not `require.resolve('<pkg>/package.json')` — @ffmpeg/core-mt declares an
 * `exports` map with only `.`, `./wasm` and `./worker` in it, so asking for
 * its package.json is a hard ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve the entry
 * point it does export, then walk up to the manifest.
 */
async function packageRoot(specifier) {
  let dir = dirname(require.resolve(specifier));
  for (let depth = 0; depth < 6; depth++) {
    if (await exists(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate the root of ${specifier}`);
}

async function main() {
  let sourceDir;
  try {
    sourceDir = await packageRoot('@ffmpeg/core-mt');
  } catch {
    console.error(
      '\n  @ffmpeg/core-mt is not installed, so public/ffmpeg/ cannot be populated.\n' +
        '  Run `pnpm install` — without it every client-side job 404s on the core.\n',
    );
    process.exit(1);
  }

  await mkdir(target, { recursive: true });

  let copied = 0;
  for (const asset of ASSETS) {
    const from = join(sourceDir, 'dist', 'esm', asset);
    const to = join(target, asset);
    if (!(await exists(from))) {
      console.error(`  missing from @ffmpeg/core-mt: ${asset}`);
      process.exit(1);
    }
    // Cheap staleness check: size. The core is versioned by its package, so a
    // content hash would cost more than it is worth on every dev start.
    const src = await stat(from);
    const dst = (await exists(to)) ? await stat(to) : null;
    if (dst && dst.size === src.size) continue;
    await copyFile(from, to);
    copied++;
  }

  if (copied > 0) console.log(`  ffmpeg core: copied ${copied} file(s) into public/ffmpeg/`);
}

await main();
