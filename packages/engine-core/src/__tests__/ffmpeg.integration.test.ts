/**
 * The edge cases, fed to a real FFmpeg.
 *
 * The unit suite in edge-cases.test.ts asserts on the command; this one
 * asserts that the command runs at all. Both are needed: argv assertions catch
 * regressions everywhere and cost nothing, but only a real binary tells you
 * that `-af atempo=2.0` against a silent file is a hard failure rather than a
 * no-op. That is the class of bug this file exists for.
 *
 * Skipped when the machine has no FFmpeg, so `pnpm test` stays green on a
 * laptop that never installed one. CI installs it, so these run before
 * anything merges.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, type CompileInput } from '../compile';
import type { Operation } from '../operation';
import {
  createFixtures,
  FFMPEG,
  HAS_FFMPEG,
  removeFixtures,
  run,
  safeName,
} from './support/ffmpeg';
import { join } from 'node:path';

let dir = '';

const source = (fsName: string, overrides: Partial<CompileInput> = {}): CompileInput => ({
  name: fsName,
  fsName: join(dir, fsName),
  bytes: 0,
  mime: 'video/mp4',
  kind: 'video',
  durationSec: 6,
  width: 640,
  height: 360,
  fps: 30,
  hasAudio: true,
  hasVideo: true,
  ...overrides,
});

const silent = (overrides: Partial<CompileInput> = {}) =>
  source('noaudio.mp4', { hasAudio: false, durationSec: 4, ...overrides });

interface Case {
  name: string;
  input: () => CompileInput;
  ops: Operation[];
  why: string;
}

const cases: Case[] = [
  {
    name: 'speed change on a silent video',
    input: silent,
    ops: [
      { stage: 'filter', op: 'setpts', factor: 2 },
      { stage: 'filter', op: 'atempo', factor: 2 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: 'atempo would go into -af against a stream that does not exist',
  },
  {
    name: 'volume change on a silent video',
    input: silent,
    ops: [
      { stage: 'filter', op: 'volume', gainDb: 3.5 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: 'same: -af against a nonexistent stream',
  },
  {
    name: 'reverse on a silent video',
    input: silent,
    ops: [
      { stage: 'filter', op: 'reverse', audio: true },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: 'areverse against a nonexistent stream',
  },
  {
    name: 'audio encoder requested for a silent video',
    input: silent,
    ops: [
      { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 128 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: '-c:a aac with no audio stream present',
  },
  {
    name: 'mute an already-silent video',
    input: silent,
    ops: [
      { stage: 'stream', op: 'dropAudio' },
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: 'should be a harmless no-op',
  },
  {
    name: 'scale to an odd width',
    input: () => source('sample.mp4'),
    ops: [
      { stage: 'filter', op: 'scale', width: 641, height: -2 },
      { stage: 'encode', op: 'video', codec: 'h264', crf: 23 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: 'h264 rejects odd dimensions — user typed 641 into a width box',
  },
  {
    name: 'scale to an odd width and an odd height',
    input: () => source('sample.mp4'),
    ops: [
      { stage: 'filter', op: 'scale', width: 641, height: 361 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: 'both axes odd, no -2 escape hatch available',
  },
  {
    name: 'crop to odd dimensions',
    input: () => source('sample.mp4'),
    ops: [
      { stage: 'filter', op: 'crop', x: 0, y: 0, width: 321, height: 241 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: 'crop box dragged to an odd pixel size',
  },
  {
    name: 'crop larger than the source',
    input: () => source('sample.mp4'),
    ops: [
      { stage: 'filter', op: 'crop', x: 400, y: 300, width: 640, height: 360 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: 'crop window runs off the edge of the frame',
  },
  {
    name: 'trim past the end of the file',
    input: () => source('sample.mp4'),
    ops: [
      { stage: 'input', op: 'seek', startSec: 4 },
      { stage: 'input', op: 'duration', seconds: 56 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: 'end time beyond duration — slider bug or stale metadata',
  },
  {
    name: 'speed factor of exactly 1',
    input: () => source('sample.mp4'),
    ops: [
      { stage: 'filter', op: 'setpts', factor: 1 },
      { stage: 'filter', op: 'atempo', factor: 1 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: 'atempo=1 is pointless but must not produce a malformed empty -af',
  },
  {
    name: 'extreme slow motion at 0.1x',
    input: () => source('sample.mp4'),
    ops: [
      { stage: 'input', op: 'duration', seconds: 1 },
      { stage: 'filter', op: 'setpts', factor: 0.1 },
      { stage: 'filter', op: 'atempo', factor: 0.1 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ],
    why: 'requires four chained atempo stages',
  },
  {
    name: 'GIF from a video that has audio',
    input: () => source('sample.mp4'),
    ops: [
      { stage: 'input', op: 'seek', startSec: 0 },
      { stage: 'input', op: 'duration', seconds: 1 },
      { stage: 'filter', op: 'fps', fps: 10 },
      { stage: 'filter', op: 'scale', width: 240, height: -2 },
      { stage: 'encode', op: 'audio', codec: 'aac' },
      { stage: 'filter', op: 'palette', colors: 128, dither: true },
      { stage: 'container', op: 'format', ext: 'gif' },
    ],
    why: 'GIF has no audio track; the audio op must be discarded, not passed through',
  },
  {
    name: 'stream-copy request into WebM from h264/aac',
    input: () => source('sample.mp4', { videoCodec: 'h264', audioCodec: 'aac' }),
    ops: [
      { stage: 'input', op: 'duration', seconds: 1 },
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'encode', op: 'audio', codec: 'copy' },
      { stage: 'container', op: 'format', ext: 'webm' },
    ],
    why: 'WebM cannot carry h264/aac — must fall back to a real encode',
  },
  {
    name: 'extract a still image',
    input: () => source('sample.mp4'),
    ops: [
      { stage: 'input', op: 'seek', startSec: 1 },
      { stage: 'filter', op: 'fit', width: 320, height: 320, mode: 'contain' },
      { stage: 'encode', op: 'image', format: 'jpeg', quality: 85 },
    ],
    why: 'image encoding path, including -frames:v and the -q:v scale inversion',
  },
];

describe.skipIf(!HAS_FFMPEG)('compiled commands run against real FFmpeg', () => {
  beforeAll(async () => {
    dir = await createFixtures();
  }, 120_000);

  afterAll(() => removeFixtures(dir));

  for (const testCase of cases) {
    it(
      `${testCase.name} — ${testCase.why}`,
      async () => {
        const job = compile([testCase.input()], testCase.ops, {
          outputBaseName: join(dir, safeName(testCase.name)),
        });

        for (const pass of job.passes) {
          // A failure here is FFmpeg refusing the command, and the rejection
          // in stderr is the whole point of this file.
          await run(FFMPEG!, pass, { maxBuffer: 64 * 1024 * 1024 });
        }

        expect(job.outputName).toBeTruthy();
      },
      120_000,
    );
  }
});

describe.skipIf(HAS_FFMPEG)('FFmpeg integration', () => {
  it('is skipped because no ffmpeg/ffprobe was found', () => {
    // Deliberately visible rather than silently absent: a green run with these
    // skipped is not the same as a green run with them passing. Put ffmpeg on
    // PATH, or set FFMPEG_PATH and FFPROBE_PATH.
    expect(HAS_FFMPEG).toBe(false);
  });
});
