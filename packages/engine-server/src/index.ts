import type { CompiledJob } from '@editz/engine-core';

/**
 * The native runner. Lands in M3.
 *
 * Rules it must hold to, stated here so they are not discovered late:
 *
 *  - FFmpeg is invoked with `child_process.spawn` and an explicit argv array.
 *    User input is never interpolated into a shell string, and there is no
 *    code path that builds one (§11).
 *  - Every job gets a wall-clock timeout and a memory cap. A pathological
 *    input must not be able to occupy a worker indefinitely.
 *  - Progress comes from parsing stderr and is written to Redis, which the
 *    SSE endpoint reads. The parse produces the same event shape as the client
 *    runner's, so the UI has one progress path, not two.
 *  - The uploaded file's real type is checked by magic bytes before FFmpeg is
 *    ever started. The client-declared MIME type is a hint, not a fact.
 */
export interface ServerJobResult {
  outputPath: string;
  bytes: number;
  durationMs: number;
}

export interface ServerRunnerOptions {
  timeoutMs: number;
  maxMemoryMb: number;
  onProgress: (fraction: number) => void;
}

export interface ServerRunner {
  run: (job: CompiledJob, inputPaths: string[], options: ServerRunnerOptions) => Promise<ServerJobResult>;
}

export const M3_PLACEHOLDER = true;
