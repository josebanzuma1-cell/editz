/**
 * Shared plumbing for the suites that need a real FFmpeg.
 *
 * Not a test file — vitest's default `include` only collects `*.test.ts`, so
 * this sits alongside without being run.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const run = promisify(execFile);

function find(bin: string, override?: string): string | null {
  for (const candidate of [override, bin]) {
    if (!candidate) continue;
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Not this one; try the next.
    }
  }
  return null;
}

export const FFMPEG = find('ffmpeg', process.env.FFMPEG_PATH);
export const FFPROBE = find('ffprobe', process.env.FFPROBE_PATH);
/** Both are needed: one to produce the file, the other to check what it is. */
export const HAS_FFMPEG = FFMPEG !== null && FFPROBE !== null;

export interface Probe {
  durationSec: number;
  width: number | undefined;
  height: number | undefined;
  videoCodec: string | undefined;
  audioCodec: string | undefined;
  hasAudio: boolean;
  hasVideo: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE!, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-show_entries', 'stream=codec_type,codec_name,width,height',
    '-of', 'json',
    file,
  ]);

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: FfprobeStream[];
  };
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');

  return {
    durationSec: Number(parsed.format?.duration ?? 0),
    width: video?.width,
    height: video?.height,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
  };
}

/**
 * A 6-second 640x360 clip with a tone, and a 4-second silent one.
 *
 * Generated rather than committed: a binary fixture in the repo is a thing
 * nobody can review, and lavfi produces the same input on every machine.
 */
export async function createFixtures(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'editz-ffmpeg-'));

  await run(FFMPEG!, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    join(dir, 'sample.mp4'),
  ]);

  await run(FFMPEG!, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    join(dir, 'noaudio.mp4'),
  ]);

  return dir;
}

export function removeFixtures(dir: string): void {
  if (dir) rmSync(dir, { recursive: true, force: true });
}

export const safeName = (name: string): string => name.replace(/[^a-z0-9]+/gi, '_');
