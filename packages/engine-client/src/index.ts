import type { CompiledJob } from '@editz/engine-core';

/**
 * The in-browser runner. Lands in M2.
 *
 * Shape it will have, fixed now so the tool page can be written against it:
 *
 *  - ffmpeg.wasm (multi-threaded core) loaded inside a Web Worker, never on
 *    the main thread. The ~30MB core is fetched only after a file has been
 *    chosen, and cached in the Cache API so a returning user never pays for it
 *    twice. Loading it on page load would blow the §9 performance budget on
 *    every landing page, including the ones nobody runs a job on.
 *  - Progress is reported by parsing FFmpeg's stderr, same as the server
 *    runner, so both paths produce identical progress events.
 *  - The job it runs is a `CompiledJob` from engine-core — the same argv the
 *    native runner would get. That is the whole point of the indirection.
 */
export interface ClientJobHandle {
  readonly id: string;
  cancel: () => void;
}

export interface ClientRunnerEvents {
  onProgress: (fraction: number) => void;
  onLog?: (line: string) => void;
}

export interface ClientRunner {
  /** Fetches and caches the wasm core. Call on file selection, not on load. */
  prepare: () => Promise<void>;
  run: (job: CompiledJob, files: File[], events: ClientRunnerEvents) => Promise<Blob>;
}

export const M2_PLACEHOLDER = true;
