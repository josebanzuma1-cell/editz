import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, type CompileInput } from '@editz/engine-core';
import { classifyFailure, parseProgressTime, runJob, ServerRunnerError } from '../runner';
import { detect, isAcceptable } from '../magic-bytes';

function findFfmpeg(): string | null {
  for (const candidate of [process.env.FFMPEG_PATH, 'ffmpeg']) {
    if (!candidate) continue;
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Try the next.
    }
  }
  return null;
}

const FFMPEG = findFfmpeg();
let dir = '';

const source = (): CompileInput => ({
  name: 'sample.mp4',
  fsName: 'sample.mp4',
  bytes: 0,
  mime: 'video/mp4',
  kind: 'video',
  durationSec: 4,
  width: 320,
  height: 240,
  fps: 25,
  hasAudio: true,
  hasVideo: true,
});

describe('parsing progress', () => {
  it('reads the elapsed time out of a status line', () => {
    expect(
      parseProgressTime('frame=100 fps=25 q=28.0 size=64kB time=00:00:04.03 bitrate=130kbits/s'),
    ).toBeCloseTo(4.03, 2);
  });

  it('ignores lines with no time in them', () => {
    expect(parseProgressTime('Stream mapping:')).toBeNull();
  });
});

describe('classifying failures', () => {
  it('recognises a missing codec', () => {
    expect(classifyFailure(['Decoder (codec hevc) not found for input stream #0:0'])).toBe(
      'unsupported-codec',
    );
  });

  it('recognises a broken container', () => {
    expect(classifyFailure(['[mov,mp4] moov atom not found'])).toBe('corrupt-input');
  });

  it('recognises a full disk, which is a server problem not a user one', () => {
    expect(classifyFailure(['av_interleaved_write_frame(): No space left on device'])).toBe(
      'no-space',
    );
  });

  it('admits it does not know rather than guessing', () => {
    expect(classifyFailure(['something new'])).toBe('unknown');
  });
});

describe('magic bytes', () => {
  // The client-declared MIME is a hint, not a fact (§11).
  const head = (...bytes: number[]) => new Uint8Array(bytes);
  const ascii = (text: string, pad = 0) =>
    new Uint8Array([...Array<number>(pad).fill(0), ...[...text].map((c) => c.charCodeAt(0))]);

  it('reads an MP4 from its ftyp brand at offset 4', () => {
    expect(detect(ascii('ftypisom', 4))).toEqual({ kind: 'video', container: 'mp4' });
  });

  it('reads a Matroska header', () => {
    expect(detect(head(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0))).toMatchObject({ kind: 'video' });
  });

  it('separates WAV, AVI and WebP, which all start RIFF', () => {
    const riff = (tag: string) =>
      new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii(tag)]);
    expect(detect(riff('WAVE'))).toEqual({ kind: 'audio', container: 'wav' });
    expect(detect(riff('WEBP'))).toEqual({ kind: 'image', container: 'webp' });
    expect(detect(riff('AVI '))).toEqual({ kind: 'video', container: 'avi' });
  });

  it('refuses a file whose bytes say nothing', () => {
    const detected = detect(ascii('<!DOCTYPE html>'));
    expect(detected.kind).toBe('unknown');
    expect(isAcceptable(detected, 'video')).toBe(false);
  });

  it('accepts a real video whatever its extension claimed', () => {
    // An MKV named .mp4 is a fine file and the user did nothing wrong.
    expect(isAcceptable(detect(head(0x1a, 0x45, 0xdf, 0xa3)), 'video')).toBe(true);
  });

  it('rejects an image where audio was expected', () => {
    expect(isAcceptable(detect(head(0xff, 0xd8, 0xff)), 'audio')).toBe(false);
  });
});

describe.skipIf(FFMPEG === null)('running real jobs', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'editz-server-'));
    execFileSync(FFMPEG!, [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
      join(dir, 'sample.mp4'),
    ]);
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('runs a compiled job and writes the file it named', async () => {
    const job = compile([source()], [
      { stage: 'encode', op: 'video', codec: 'h264', crf: 30, preset: 'veryfast' },
      { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 96 },
      { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
    ]);

    const result = await runJob(job, { cwd: dir, timeoutMs: 60_000, ffmpegPath: FFMPEG! });

    expect(result.outputName).toBe('output.mp4');
    expect(statSync(join(dir, 'output.mp4')).size).toBeGreaterThan(1000);
  }, 120_000);

  it('reports progress that only ever goes forwards', async () => {
    const seen: number[] = [];
    const job = compile([source()], [
      { stage: 'encode', op: 'video', codec: 'h264', crf: 30, preset: 'veryfast' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ], { outputBaseName: 'progress' });

    await runJob(job, {
      cwd: dir,
      timeoutMs: 60_000,
      ffmpegPath: FFMPEG!,
      onProgress: (f) => seen.push(f),
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBeCloseTo(1, 5);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('kills a job that outruns its wall clock', async () => {
    // A pathological input must not be able to occupy a worker indefinitely.
    const job = compile([source()], [
      { stage: 'input', op: 'loop', count: 50 },
      { stage: 'encode', op: 'video', codec: 'h264', crf: 18, preset: 'slow' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ], { outputBaseName: 'timeout' });

    await expect(
      runJob(job, { cwd: dir, timeoutMs: 700, ffmpegPath: FFMPEG! }),
    ).rejects.toMatchObject({ code: 'timed-out' });
  }, 120_000);

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const job = compile([source()], [
      { stage: 'input', op: 'loop', count: 50 },
      { stage: 'encode', op: 'video', codec: 'h264', crf: 18, preset: 'slow' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ], { outputBaseName: 'aborted' });

    const running = runJob(job, {
      cwd: dir,
      timeoutMs: 60_000,
      ffmpegPath: FFMPEG!,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 400);

    await expect(running).rejects.toMatchObject({ code: 'killed' });
  }, 120_000);

  it('classifies a genuinely broken file rather than reporting a raw exit code', async () => {
    writeFileSync(join(dir, 'broken.mp4'), Buffer.from('not a video at all, just text'));
    const job = compile([{ ...source(), fsName: 'broken.mp4' }], [
      { stage: 'encode', op: 'video', codec: 'h264', crf: 30 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ], { outputBaseName: 'broken-out' });

    await expect(runJob(job, { cwd: dir, timeoutMs: 30_000, ffmpegPath: FFMPEG! })).rejects.toBeInstanceOf(
      ServerRunnerError,
    );
  }, 120_000);

  it('never builds a shell string, even from a hostile filename', async () => {
    const hostile = "in'; touch pwned; echo '.mp4";
    const job = compile([{ ...source(), fsName: hostile }], [
      { stage: 'container', op: 'format', ext: 'mp4' },
    ], { outputBaseName: 'hostile' });

    // The file does not exist, so this fails — the point is *how*. With a
    // shell it would run `touch`; with an argv it reports one missing file.
    await expect(runJob(job, { cwd: dir, timeoutMs: 30_000, ffmpegPath: FFMPEG! })).rejects.toBeDefined();
    expect(() => statSync(join(dir, 'pwned'))).toThrow();
  }, 120_000);
});

describe.skipIf(FFMPEG !== null)('native runner', () => {
  it('is skipped because no ffmpeg was found', () => {
    expect(FFMPEG).toBeNull();
  });
});
