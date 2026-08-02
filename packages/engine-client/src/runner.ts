import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { CompiledJob } from '@editz/engine-core';
import { resolveCore, type CoreLoadProgress } from './core-source';
import { ProgressTracker, parseDuration } from './progress';

/**
 * The in-browser runner.
 *
 * Runs the argv that `engine-core` compiled — the same argv the native worker
 * will run in M3. Nothing here knows what a tool is, and nothing here builds
 * an FFmpeg flag. If this file ever needs to special-case a tool, the
 * abstraction has gone wrong somewhere upstream.
 *
 * ffmpeg.wasm owns its own Worker, so decoding never touches the main thread.
 * What this class adds on top is the part that is ours: the deferred, cached
 * core fetch, honest progress, cancellation, and cleaning the virtual
 * filesystem up afterwards so a second job on the same page does not inherit
 * the first one's files.
 */

export interface RunProgress {
  /** 0–1, monotonic. */
  fraction: number;
  stage: 'loading-core' | 'writing' | 'running' | 'reading';
}

export interface RunOptions {
  /** All inputs, in the order the compiler expects them. */
  files: readonly File[];
  /** Filesystem names, matching the `fsName` given to `compile`. */
  fsNames: readonly string[];
  /** Expected output length, for the progress fraction. */
  expectedDurationSec?: number;
  onProgress?: (progress: RunProgress) => void;
  onCoreLoad?: (progress: CoreLoadProgress) => void;
  /** Raw FFmpeg log lines. Useful in development; never shown to a user (§7). */
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

export class ClientRunnerError extends Error {
  readonly logTail: string[];
  constructor(message: string, logTail: string[]) {
    super(message);
    this.name = 'ClientRunnerError';
    this.logTail = logTail;
  }
}

export class ClientRunner {
  private ffmpeg: FFmpeg | null = null;
  private loading: Promise<FFmpeg> | null = null;
  private readonly coreBase: string | undefined;

  constructor(options: { coreBase?: string } = {}) {
    this.coreBase = options.coreBase;
  }

  /**
   * Fetches and instantiates the core.
   *
   * Call this when the user picks a file, not when the page loads. The core is
   * ~30MB; downloading it on a landing page nobody runs a job on is exactly
   * the behaviour this product exists to avoid.
   */
  async prepare(onCoreLoad?: (progress: CoreLoadProgress) => void): Promise<void> {
    await this.instance(onCoreLoad);
  }

  private instance(onCoreLoad?: (progress: CoreLoadProgress) => void): Promise<FFmpeg> {
    if (this.ffmpeg) return Promise.resolve(this.ffmpeg);
    // Concurrent callers share one load rather than racing two 30MB fetches.
    this.loading ??= (async () => {
      const source = await resolveCore(this.coreBase, onCoreLoad);
      const ffmpeg = new FFmpeg();
      await ffmpeg.load(source);
      this.ffmpeg = ffmpeg;
      return ffmpeg;
    })();
    return this.loading;
  }

  async run(job: CompiledJob, options: RunOptions): Promise<Blob> {
    const { files, fsNames, onProgress, onLog, signal } = options;

    if (files.length !== fsNames.length) {
      throw new ClientRunnerError('Runner was given a different number of files and names.', []);
    }

    onProgress?.({ fraction: 0, stage: 'loading-core' });
    const ffmpeg = await this.instance(options.onCoreLoad);
    throwIfAborted(signal);

    const tracker = new ProgressTracker(options.expectedDurationSec);
    const logTail: string[] = [];

    const onFfmpegLog = ({ message }: { message: string }) => {
      onLog?.(message);
      // Keep the last few lines: when FFmpeg fails, the reason is in them, and
      // it is the only thing that makes a failure diagnosable after the fact.
      logTail.push(message);
      if (logTail.length > 40) logTail.shift();

      if (options.expectedDurationSec === undefined) parseDuration(message);
      const fraction = tracker.push(message);
      if (fraction !== null) onProgress?.({ fraction, stage: 'running' });
    };

    ffmpeg.on('log', onFfmpegLog);

    const written: string[] = [];
    const abort = () => void ffmpeg.terminate();
    signal?.addEventListener('abort', abort, { once: true });

    try {
      onProgress?.({ fraction: 0, stage: 'writing' });
      for (const [index, file] of files.entries()) {
        const name = fsNames[index]!;
        await ffmpeg.writeFile(name, new Uint8Array(await file.arrayBuffer()));
        written.push(name);
        throwIfAborted(signal);
      }

      // Aux files are the compiler's — a drawtext body, a concat list. They
      // exist so that nothing user-typed has to be escaped into an argument.
      for (const aux of job.auxFiles) {
        await ffmpeg.writeFile(aux.name, new TextEncoder().encode(aux.content));
        written.push(aux.name);
      }

      onProgress?.({ fraction: 0, stage: 'running' });
      for (const pass of job.passes) {
        const code = await ffmpeg.exec([...pass]);
        throwIfAborted(signal);
        if (code !== 0) {
          throw new ClientRunnerError(`FFmpeg exited with code ${code}.`, [...logTail]);
        }
      }

      onProgress?.({ fraction: tracker.complete(), stage: 'reading' });
      const data = await ffmpeg.readFile(job.outputName);
      written.push(job.outputName);

      if (typeof data === 'string') {
        throw new ClientRunnerError('Expected binary output, got text.', [...logTail]);
      }
      // Copy out of the wasm heap: the underlying buffer is reused, so a Blob
      // built on the live view can change under you after the next job.
      return new Blob([new Uint8Array(data)]);
    } finally {
      signal?.removeEventListener('abort', abort);
      ffmpeg.off('log', onFfmpegLog);
      // Wasm memory is not reclaimed by the browser between jobs, so leaving
      // a 200MB input in the virtual filesystem is how the second job on a
      // page runs out of heap.
      await this.cleanup(written);
    }
  }

  private async cleanup(names: string[]): Promise<void> {
    if (!this.ffmpeg) return;
    for (const name of names) {
      try {
        await this.ffmpeg.deleteFile(name);
      } catch {
        // Already gone, or the job was terminated mid-write.
      }
    }
  }

  /** Tears down the worker and frees the wasm heap. The cached core survives. */
  terminate(): void {
    this.ffmpeg?.terminate();
    this.ffmpeg = null;
    this.loading = null;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}
