import { spawn } from 'node:child_process';
import type { CompiledJob } from '@editz/engine-core';

/**
 * The native runner.
 *
 * Runs the same argv the browser runs. The only differences that matter are
 * that this one has a real filesystem, no 2GB heap ceiling, and a machine we
 * are paying for — so unlike the browser it must be defended against jobs that
 * never finish.
 *
 * Rules it holds to, from §11:
 *   - FFmpeg is invoked with an argv array. There is no shell anywhere in this
 *     file, and no code path that builds a command string.
 *   - Every job has a wall-clock timeout. A pathological input must not be
 *     able to occupy a worker indefinitely.
 *   - Progress is parsed from stderr and reported in the same shape the client
 *     runner reports, so the UI has one progress path rather than two.
 */

export type ServerFailureCode =
  | 'timed-out'
  | 'killed'
  | 'unsupported-codec'
  | 'corrupt-input'
  | 'no-space'
  | 'unknown';

export class ServerRunnerError extends Error {
  readonly code: ServerFailureCode;
  readonly exitCode: number | null;
  readonly logTail: readonly string[];

  constructor(code: ServerFailureCode, exitCode: number | null, logTail: readonly string[]) {
    super(`ffmpeg: ${code}`);
    this.name = 'ServerRunnerError';
    this.code = code;
    this.exitCode = exitCode;
    this.logTail = logTail;
  }
}

export interface RunOptions {
  /** Working directory. Inputs and outputs are resolved against it. */
  cwd: string;
  /** Hard wall-clock limit for the whole job. */
  timeoutMs: number;
  /** Reported as 0–1, monotonic. */
  onProgress?: (fraction: number) => void;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
  /** Path to the binary. Defaults to `ffmpeg` on PATH. */
  ffmpegPath?: string;
}

export interface RunResult {
  outputName: string;
  durationMs: number;
}

const TIME = /time=\s*(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/;

/** Shared with engine-client's parser — same field, same shape, one behaviour. */
export function parseProgressTime(line: string): number | null {
  const match = TIME.exec(line);
  if (!match) return null;
  const [, h, m, s, fraction] = match;
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${fraction ?? '0'}`);
  return Number.isFinite(seconds) ? seconds : null;
}

export function classifyFailure(logTail: readonly string[]): ServerFailureCode {
  const text = logTail.join('\n');
  if (/no space left on device/i.test(text)) return 'no-space';
  if (/(decoder|encoder) .*not found|unknown (decoder|encoder)/i.test(text)) {
    return 'unsupported-codec';
  }
  if (/invalid data found|moov atom not found|could not find codec parameters/i.test(text)) {
    return 'corrupt-input';
  }
  return 'unknown';
}

/**
 * Runs one compiled job to completion.
 *
 * Every pass is run in order; `passes` is plural because targeting an exact
 * output size is genuinely two-pass.
 */
export async function runJob(job: CompiledJob, options: RunOptions): Promise<RunResult> {
  const started = Date.now();

  for (const [index, pass] of job.passes.entries()) {
    await runPass(pass, {
      ...options,
      // Split the budget across passes rather than giving each the full
      // timeout, or a two-pass job gets twice the wall clock it was allowed.
      timeoutMs: Math.floor(options.timeoutMs / job.passes.length),
      ...(job.outputDurationSec !== undefined
        ? { expectedDurationSec: job.outputDurationSec }
        : {}),
      passIndex: index,
      passCount: job.passes.length,
    });
  }

  return { outputName: job.outputName, durationMs: Date.now() - started };
}

interface PassOptions extends RunOptions {
  expectedDurationSec?: number;
  passIndex: number;
  passCount: number;
}

function runPass(args: readonly string[], options: PassOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const logTail: string[] = [];
    let highest = 0;
    let settled = false;

    // No shell. `args` came from engine-core and contains user-derived values
    // — filenames, text overlays — which is exactly why this is an array.
    const child = spawn(options.ffmpegPath ?? 'ffmpeg', [...args], {
      cwd: options.cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });

    const finish = (error?: ServerRunnerError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new ServerRunnerError('timed-out', null, logTail));
    }, options.timeoutMs);

    const onAbort = () => {
      child.kill('SIGKILL');
      finish(new ServerRunnerError('killed', null, logTail));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    let buffer = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      buffer += chunk;
      // FFmpeg rewrites its status line with \r, so split on both.
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line) continue;
        options.onLog?.(line);
        logTail.push(line);
        if (logTail.length > 60) logTail.shift();

        const time = parseProgressTime(line);
        if (time === null || options.expectedDurationSec === undefined) continue;

        // Spread the fraction across passes so a two-pass job does not run
        // 0-100% twice.
        const within = Math.min(1, Math.max(0, time / options.expectedDurationSec));
        const overall = (options.passIndex + within) / options.passCount;
        if (overall > highest) {
          highest = overall;
          options.onProgress?.(overall);
        }
      }
    });

    child.on('error', (error) => {
      finish(new ServerRunnerError('unknown', null, [...logTail, String(error)]));
    });

    child.on('close', (code, signalName) => {
      if (settled) return;
      if (code === 0) {
        options.onProgress?.((options.passIndex + 1) / options.passCount);
        finish();
        return;
      }
      finish(
        new ServerRunnerError(
          signalName ? 'killed' : classifyFailure(logTail),
          code,
          logTail,
        ),
      );
    });
  });
}
