import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { CompiledJob } from '@editz/engine-core';
import { resolveCore, type CoreLoadProgress } from './core-source';
import { ProgressTracker } from './progress';
import { parseProbeOutput, type ProbeResult } from './probe';
import { classifyFailure, type FailureCode } from './failures';

/**
 * The in-browser runner.
 *
 * Runs the argv that `engine-core` compiled — the same argv the native worker
 * will run in M3. Nothing here knows what a tool is, and nothing here builds an
 * FFmpeg flag. If this file ever needs to special-case a tool, something
 * upstream has gone wrong.
 *
 * ffmpeg.wasm owns its own Worker, so decoding never touches the main thread.
 * What this class adds is the part that is ours: the deferred, cached core
 * fetch, honest progress, cancellation, and cleaning the virtual filesystem so
 * a second job on a page does not inherit the first one's files.
 */

export interface RunProgress {
  /** 0–1, monotonic. */
  fraction: number;
  stage: 'loading-core' | 'reading-file' | 'inspecting' | 'running' | 'finishing';
}

export interface ExecuteOptions {
  files: readonly File[];
  /** Filesystem names, matching the `fsName` handed to `compile`. */
  fsNames: readonly string[];
  /**
   * Builds the job once FFmpeg has said what is actually in the file.
   *
   * The callback shape exists so the input is written to the virtual
   * filesystem exactly once: probe and run share it. Probing separately would
   * mean copying a 200MB file into wasm memory twice.
   */
  build: (probe: ProbeResult) => { job: CompiledJob; expectedDurationSec?: number };
  onProgress?: (progress: RunProgress) => void;
  onCoreLoad?: (progress: CoreLoadProgress) => void;
  /** Raw FFmpeg log lines. For development; never shown to a user (§7). */
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

export interface ExecuteResult {
  blob: Blob;
  job: CompiledJob;
  probe: ProbeResult;
}

export class ClientRunnerError extends Error {
  readonly code: FailureCode;
  readonly logTail: readonly string[];

  constructor(code: FailureCode, logTail: readonly string[]) {
    super(`client runner: ${code}`);
    this.name = 'ClientRunnerError';
    this.code = code;
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
   * Call this when the user picks a file, never when the page loads. The core
   * is ~31MB; downloading it on a landing page nobody runs a job on is exactly
   * the behaviour this product exists to avoid.
   */
  async prepare(onCoreLoad?: (progress: CoreLoadProgress) => void): Promise<void> {
    await this.instance(onCoreLoad);
  }

  private instance(onCoreLoad?: (progress: CoreLoadProgress) => void): Promise<FFmpeg> {
    if (this.ffmpeg) return Promise.resolve(this.ffmpeg);
    // Concurrent callers share one load rather than racing two 31MB fetches.
    this.loading ??= (async () => {
      const source = await resolveCore(this.coreBase, onCoreLoad);
      const ffmpeg = new FFmpeg();
      // A worker that fails to boot never replies, and `load()` waits on that
      // reply forever — the failure mode is an infinite spinner with nothing
      // in the console. Bound it so a broken core surfaces as an error.
      await withTimeout(ffmpeg.load(source), LOAD_TIMEOUT_MS, 'engine did not start');
      this.ffmpeg = ffmpeg;
      return ffmpeg;
    })().catch((error: unknown) => {
      // Let the next attempt retry rather than caching a rejected promise.
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  async execute(options: ExecuteOptions): Promise<ExecuteResult> {
    const { files, fsNames, build, onProgress, onLog, signal } = options;

    if (files.length !== fsNames.length) {
      throw new ClientRunnerError('unknown', ['runner: file and name counts differ']);
    }

    onProgress?.({ fraction: 0, stage: 'loading-core' });
    const ffmpeg = await this.instance(options.onCoreLoad);
    throwIfAborted(signal);

    const logTail: string[] = [];
    let capture: string[] | null = null;
    let tracker: ProgressTracker | null = null;

    const onFfmpegLog = ({ message }: { message: string }) => {
      onLog?.(message);
      capture?.push(message);

      // Keep the last lines: when FFmpeg fails, the reason is in them, and it
      // is the only thing that makes the failure classifiable afterwards.
      logTail.push(message);
      if (logTail.length > 60) logTail.shift();

      const fraction = tracker?.push(message);
      if (fraction != null) onProgress?.({ fraction, stage: 'running' });
    };

    ffmpeg.on('log', onFfmpegLog);
    const written: string[] = [];
    const abort = () => void ffmpeg.terminate();
    signal?.addEventListener('abort', abort, { once: true });

    try {
      onProgress?.({ fraction: 0, stage: 'reading-file' });
      for (const [index, file] of files.entries()) {
        const name = fsNames[index]!;
        await ffmpeg.writeFile(name, new Uint8Array(await file.arrayBuffer()));
        written.push(name);
        throwIfAborted(signal);
      }

      // Ask FFmpeg what is actually in the file. This is the only way to know
      // in Chromium whether there is an audio track at all, and it is what
      // lets the compiler stream-copy safely.
      //
      // It has to *succeed*. The obvious probe — an input with no output —
      // makes FFmpeg exit non-zero, and in wasm a non-zero exit runs
      // emscripten's `Aborted()`, which tears the runtime down: every later
      // `exec` on the same instance then dies partway through with no useful
      // error. Short jobs survive it by luck. So write a fraction of a second
      // to the null muxer instead: the stream table is printed, one frame is
      // touched, and the process exits 0.
      onProgress?.({ fraction: 0, stage: 'inspecting' });
      capture = [];
      await ffmpeg.exec(['-hide_banner', '-t', '0.04', '-i', fsNames[0]!, '-f', 'null', '-']);
      const probe = parseProbeOutput(capture);
      capture = null;
      throwIfAborted(signal);

      const { job, expectedDurationSec } = build(probe);
      tracker = new ProgressTracker(expectedDurationSec);

      for (const aux of job.auxFiles) {
        await ffmpeg.writeFile(aux.name, new TextEncoder().encode(aux.content));
        written.push(aux.name);
      }

      onProgress?.({ fraction: 0, stage: 'running' });
      for (const pass of job.passes) {
        const code = await ffmpeg.exec([...pass]);
        throwIfAborted(signal);
        if (code !== 0) throw new ClientRunnerError(classifyFailure(logTail), [...logTail]);
      }

      onProgress?.({ fraction: tracker.complete(), stage: 'finishing' });
      const data = await ffmpeg.readFile(job.outputName);
      written.push(job.outputName);
      if (typeof data === 'string') {
        throw new ClientRunnerError('unknown', [...logTail, 'expected binary output, got text']);
      }

      // Copy out of the wasm heap: the underlying buffer is reused, so a Blob
      // built on the live view changes under you on the next job.
      return { blob: new Blob([new Uint8Array(data)]), job, probe };
    } catch (error) {
      if (signal?.aborted) throw new ClientRunnerError('cancelled', []);
      if (error instanceof ClientRunnerError) throw error;
      throw new ClientRunnerError(classifyFailure(logTail), [...logTail]);
    } finally {
      signal?.removeEventListener('abort', abort);
      ffmpeg.off('log', onFfmpegLog);
      // Wasm memory is not reclaimed between jobs, so leaving a 200MB input in
      // the virtual filesystem is how the second job runs out of heap.
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
  if (signal?.aborted) throw new ClientRunnerError('cancelled', []);
}

/** Generous: on a slow phone, instantiating 31MB of wasm genuinely takes a while. */
const LOAD_TIMEOUT_MS = 90_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ClientRunnerError('unknown', [reason])), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
