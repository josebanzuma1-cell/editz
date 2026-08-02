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

async function main() {
  let sourceDir;
  try {
    sourceDir = dirname(require.resolve('@ffmpeg/core-mt/package.json'));
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
    const [src, dst] = await Promise.all([stat(from), exists(to) ? stat(to) : null]);
    if (dst && dst.size === src.size) continue;
    await copyFile(from, to);
    copied++;
  }

  if (copied > 0) console.log(`  ffmpeg core: copied ${copied} file(s) into public/ffmpeg/`);
}

await main();
