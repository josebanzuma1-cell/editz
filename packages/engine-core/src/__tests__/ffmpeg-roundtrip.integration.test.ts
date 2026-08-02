/**
 * Round trip: compile, run, then probe what actually came out.
 *
 * Asserting on argv only proves the compiler agrees with itself. Asserting
 * that FFmpeg accepted the command only proves it did not crash. Neither one
 * catches a 2x speed change that produces a six-second file, or a "contain"
 * fit that quietly returns 400x225 instead of 400x400. Reading the output back
 * with ffprobe is the only thing that proves a tool will work for a user.
 *
 * Skipped without a local FFmpeg; CI installs one.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, type CompileInput } from '../compile';
import type { Operation } from '../operation';
import {
  createFixtures,
  FFMPEG,
  HAS_FFMPEG,
  probe,
  removeFixtures,
  run,
  safeName,
  type Probe,
} from './support/ffmpeg';

let dir = '';

const source = (): CompileInput => ({
  name: 'sample.mp4',
  fsName: join(dir, 'sample.mp4'),
  bytes: 0,
  mime: 'video/mp4',
  kind: 'video',
  durationSec: 6,
  width: 640,
  height: 360,
  fps: 30,
  hasAudio: true,
  hasVideo: true,
});

interface Case {
  tool: string;
  ops: Operation[];
  /** What the file has to be, not merely that one got written. */
  check?: (p: Probe) => void;
  /** Probed source codecs, for the copy-legality path. */
  input?: Partial<CompileInput>;
}

const near = (actual: number, expected: number, tolerance: number) => {
  expect(
    Math.abs(actual - expected),
    `expected ~${expected}s, got ${actual}s`,
  ).toBeLessThan(tolerance);
};

const cases: Case[] = [
  {
    tool: 'compress-video',
    ops: [
      { stage: 'encode', op: 'video', codec: 'h264', crf: 28, preset: 'veryfast' },
      { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 96 },
      { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
    ],
    check: (p) => expect(p.videoCodec).toBe('h264'),
  },
  {
    tool: 'trim-video (re-encode)',
    ops: [
      { stage: 'input', op: 'seek', startSec: 1 },
      { stage: 'input', op: 'duration', seconds: 2 },
      { stage: 'encode', op: 'video', codec: 'h264', crf: 23 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => near(p.durationSec, 2, 0.25),
  },
  {
    tool: 'trim-video (stream copy)',
    ops: [
      { stage: 'input', op: 'seek', startSec: 1 },
      { stage: 'input', op: 'duration', seconds: 3 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    // Wider tolerance on purpose: a stream copy lands on a keyframe, which is
    // the trade the tool advertises.
    check: (p) => near(p.durationSec, 3, 0.6),
  },
  {
    tool: 'resize-video',
    ops: [
      { stage: 'filter', op: 'scale', width: 320, height: -2 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => expect(p.width).toBe(320),
  },
  {
    tool: 'resize-video (contain/pad)',
    ops: [
      { stage: 'filter', op: 'fit', width: 400, height: 400, mode: 'contain' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => {
      expect(p.width).toBe(400);
      expect(p.height).toBe(400);
    },
  },
  {
    tool: 'resize-video (cover/crop)',
    ops: [
      { stage: 'filter', op: 'fit', width: 300, height: 300, mode: 'cover' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => {
      expect(p.width).toBe(300);
      expect(p.height).toBe(300);
    },
  },
  {
    tool: 'crop-video',
    ops: [
      { stage: 'filter', op: 'crop', x: 20, y: 10, width: 320, height: 240 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => {
      expect(p.width).toBe(320);
      expect(p.height).toBe(240);
    },
  },
  {
    tool: 'rotate-video',
    ops: [
      { stage: 'filter', op: 'transpose', direction: 'cw' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => {
      expect(p.width).toBe(360);
      expect(p.height).toBe(640);
    },
  },
  {
    tool: 'flip-video',
    ops: [
      { stage: 'filter', op: 'transpose', direction: 'hflip' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => {
      expect(p.width).toBe(640);
      expect(p.height).toBe(360);
    },
  },
  {
    tool: 'speed-video (2x)',
    ops: [
      { stage: 'filter', op: 'setpts', factor: 2 },
      { stage: 'filter', op: 'atempo', factor: 2 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => near(p.durationSec, 3, 0.3),
  },
  {
    tool: 'speed-video (4x — exercises atempo chaining)',
    ops: [
      { stage: 'filter', op: 'setpts', factor: 4 },
      { stage: 'filter', op: 'atempo', factor: 4 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => near(p.durationSec, 1.5, 0.3),
  },
  {
    tool: 'speed-video (0.25x — exercises slow chaining)',
    ops: [
      { stage: 'filter', op: 'setpts', factor: 0.25 },
      { stage: 'filter', op: 'atempo', factor: 0.25 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => near(p.durationSec, 24, 1),
  },
  {
    tool: 'trim + speed together',
    ops: [
      { stage: 'input', op: 'seek', startSec: 0 },
      { stage: 'input', op: 'duration', seconds: 4 },
      { stage: 'filter', op: 'setpts', factor: 2 },
      { stage: 'filter', op: 'atempo', factor: 2 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    // The one everybody gets wrong: -t is in output time, so four seconds of
    // source at 2x is two seconds of file, not four.
    check: (p) => near(p.durationSec, 2, 0.3),
  },
  {
    tool: 'mute-video',
    ops: [
      { stage: 'stream', op: 'dropAudio' },
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => {
      expect(p.hasAudio).toBe(false);
      expect(p.hasVideo).toBe(true);
    },
  },
  {
    tool: 'extract-audio',
    ops: [
      { stage: 'stream', op: 'dropVideo' },
      { stage: 'encode', op: 'audio', codec: 'mp3', bitrateKbps: 192 },
      { stage: 'container', op: 'format', ext: 'mp3' },
    ],
    check: (p) => {
      expect(p.hasVideo).toBe(false);
      expect(p.hasAudio).toBe(true);
      expect(p.audioCodec).toBe('mp3');
    },
  },
  {
    tool: 'adjust-video',
    ops: [
      { stage: 'filter', op: 'eq', brightness: 0.1, contrast: 1.2, saturation: 1.4 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => expect(p.hasVideo).toBe(true),
  },
  {
    tool: 'volume',
    // Ours is in decibels rather than a linear multiplier; 3.5dB is ~1.5x.
    ops: [
      { stage: 'filter', op: 'volume', gainDb: 3.5 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => expect(p.hasAudio).toBe(true),
  },
  {
    tool: 'fps',
    ops: [
      { stage: 'filter', op: 'fps', fps: 15 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => near(p.durationSec, 6, 0.4),
  },
  {
    tool: 'reverse-video',
    ops: [
      { stage: 'filter', op: 'reverse', audio: true },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    check: (p) => near(p.durationSec, 6, 0.4),
  },
  {
    tool: 'gif-maker',
    ops: [
      { stage: 'input', op: 'seek', startSec: 0 },
      { stage: 'input', op: 'duration', seconds: 2 },
      { stage: 'filter', op: 'fps', fps: 12 },
      { stage: 'filter', op: 'scale', width: 320, height: -2 },
      { stage: 'filter', op: 'palette', colors: 256, dither: true },
      { stage: 'container', op: 'format', ext: 'gif' },
    ],
    check: (p) => {
      expect(p.width).toBe(320);
      expect(p.hasAudio).toBe(false);
    },
  },
  {
    tool: 'convert-to-webm',
    ops: [
      { stage: 'input', op: 'duration', seconds: 2 },
      { stage: 'encode', op: 'video', codec: 'vp9', crf: 40 },
      { stage: 'encode', op: 'audio', codec: 'opus' },
      { stage: 'container', op: 'format', ext: 'webm' },
    ],
    check: (p) => expect(p.videoCodec).toBe('vp9'),
  },
  {
    tool: 'remux-to-mkv (no re-encode)',
    input: { videoCodec: 'h264', audioCodec: 'aac' },
    ops: [{ stage: 'container', op: 'format', ext: 'mkv' }],
    // Matroska carries anything, so this must stay a copy. If it comes back
    // re-encoded, the container table is wrong and every remux just got slow.
    check: (p) => {
      expect(p.videoCodec).toBe('h264');
      expect(p.hasAudio).toBe(true);
    },
  },
];

describe.skipIf(!HAS_FFMPEG)('compiled commands produce the file they promised', () => {
  beforeAll(async () => {
    dir = await createFixtures();
  }, 120_000);

  afterAll(() => removeFixtures(dir));

  for (const testCase of cases) {
    it(
      testCase.tool,
      async () => {
        const job = compile(
          [{ ...source(), ...testCase.input }],
          testCase.ops,
          { outputBaseName: join(dir, safeName(testCase.tool)) },
        );

        for (const pass of job.passes) {
          await run(FFMPEG!, pass, { maxBuffer: 64 * 1024 * 1024 });
        }

        // No globbing for the result — the compiler already told us its name,
        // and if that name is wrong the probe failing is the correct outcome.
        const result = await probe(job.outputName);
        testCase.check?.(result);
      },
      180_000,
    );
  }
});
