/**
 * The cases real users hit and happy-path tests never catch.
 *
 * Each one is a bug someone has shipped before. These assert on the command
 * rather than on FFmpeg's exit code, so they run everywhere; the companion
 * suite in ffmpeg.integration.test.ts feeds the same list to a real binary.
 */
import { describe, expect, it } from 'vitest';
import { compile, type CompileInput } from '../compile';
import type { CompileError } from '../notes';
import type { Operation } from '../operation';

const withAudio: CompileInput = {
  name: 'sample.mp4',
  fsName: 'sample.mp4',
  bytes: 1_000_000,
  mime: 'video/mp4',
  kind: 'video',
  durationSec: 6,
  width: 640,
  height: 360,
  fps: 30,
  hasAudio: true,
  hasVideo: true,
};

const silent: CompileInput = { ...withAudio, fsName: 'noaudio.mp4', durationSec: 4, hasAudio: false };

const valueOf = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

const argsFor = (input: CompileInput, ops: Operation[]) => compile([input], ops).passes[0]!;

describe('a source with no audio track', () => {
  // Plenty of screen recordings and phone clips are silent. An audio filter
  // against a stream that is not there fails with "Stream specifier ':a' in
  // filtergraph description matches no streams" — a job that looks entirely
  // reasonable in the UI and cannot run.
  it('drops the tempo filter from a speed change', () => {
    const args = argsFor(silent, [
      { stage: 'filter', op: 'setpts', factor: 2 },
      { stage: 'filter', op: 'atempo', factor: 2 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(args).not.toContain('-af');
    expect(args).toContain('-an');
    expect(valueOf(args, '-vf')).toContain('setpts=0.5*PTS');
  });

  it('drops a volume change', () => {
    const args = argsFor(silent, [
      { stage: 'filter', op: 'volume', gainDb: 3.5 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(args).not.toContain('-af');
  });

  it('drops areverse from a reverse', () => {
    const args = argsFor(silent, [
      { stage: 'filter', op: 'reverse', audio: true },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(args).not.toContain('-af');
    expect(valueOf(args, '-vf')).toContain('reverse');
  });

  it('does not ask for an audio encoder', () => {
    const args = argsFor(silent, [
      { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 128 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(args).not.toContain('-c:a');
    expect(args).toContain('-an');
  });

  it('treats muting an already-silent file as a harmless no-op', () => {
    const job = compile([silent], [
      { stage: 'stream', op: 'dropAudio' },
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(job.passes[0]).toContain('-an');
    expect(valueOf(job.passes[0]!, '-c:v')).toBe('copy');
    expect(job.reencode).toBe(false);
  });
});

describe('odd dimensions', () => {
  it('handles an odd width typed into a box', () => {
    const args = argsFor(withAudio, [
      { stage: 'filter', op: 'scale', width: 641, height: -2 },
      { stage: 'encode', op: 'video', codec: 'h264', crf: 23 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(valueOf(args, '-vf')).toContain('trunc(iw/2)*2');
  });

  it('handles both axes odd, where -2 is not available as an escape hatch', () => {
    const args = argsFor(withAudio, [
      { stage: 'filter', op: 'scale', width: 641, height: 361 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    const chain = valueOf(args, '-vf')!;
    expect(chain).toContain('scale=641:361');
    expect(chain).toContain('trunc(iw/2)*2');
  });

  it('handles a crop box dragged to an odd size', () => {
    const args = argsFor(withAudio, [
      { stage: 'filter', op: 'crop', x: 0, y: 0, width: 321, height: 241 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(valueOf(args, '-vf')).toContain('trunc(iw/2)*2');
  });
});

describe('out-of-range parameters', () => {
  it('pulls a crop box back inside the frame', () => {
    const job = compile([withAudio], [
      { stage: 'filter', op: 'crop', x: 400, y: 300, width: 640, height: 360 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(valueOf(job.passes[0]!, '-vf')).toContain('crop=640:360:0:0');
    expect(job.notes.map((n) => n.code)).toContain('crop-clamped-to-frame');
  });

  it('clamps a trim that runs past the end of the file', () => {
    // FFmpeg stops at EOF anyway, but an honest -t keeps the progress
    // percentage and the size estimate from being nonsense for the whole job.
    const args = argsFor(withAudio, [
      { stage: 'input', op: 'seek', startSec: 4 },
      { stage: 'input', op: 'duration', seconds: 56 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(valueOf(args, '-t')).toBe('2');
  });

  it('rejects a zero-length trim rather than writing a header-only file', () => {
    try {
      argsFor(withAudio, [
        { stage: 'input', op: 'seek', startSec: 2 },
        { stage: 'input', op: 'duration', seconds: 0 },
      ]);
      expect.unreachable();
    } catch (error) {
      expect((error as CompileError).code).toBe('range-empty');
    }
  });

  it('rejects a trim starting past the end', () => {
    try {
      argsFor(withAudio, [
        { stage: 'input', op: 'seek', startSec: 30 },
        { stage: 'input', op: 'duration', seconds: 10 },
      ]);
      expect.unreachable();
    } catch (error) {
      expect((error as CompileError).code).toBe('range-starts-after-end');
    }
  });
});

describe('speed extremes', () => {
  it('emits no audio filter at all for 1x, rather than a malformed empty one', () => {
    const args = argsFor(withAudio, [
      { stage: 'filter', op: 'setpts', factor: 1 },
      { stage: 'filter', op: 'atempo', factor: 1 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(args).not.toContain('-af');
  });

  it('chains four atempo stages for 0.1x', () => {
    const args = argsFor(withAudio, [
      { stage: 'filter', op: 'setpts', factor: 0.1 },
      { stage: 'filter', op: 'atempo', factor: 0.1 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    const chain = valueOf(args, '-af')!;
    expect(chain.split(',')).toHaveLength(4);
    const product = chain.split(',').reduce((acc, p) => acc * Number(p.split('=')[1]), 1);
    expect(product).toBeCloseTo(0.1, 5);
  });
});

describe('containers that refuse a stream', () => {
  it('discards audio when the target is a GIF', () => {
    // The GIF muxer refuses a file with audio in it: "Could not write header".
    const args = argsFor(withAudio, [
      { stage: 'input', op: 'seek', startSec: 0 },
      { stage: 'input', op: 'duration', seconds: 1 },
      { stage: 'encode', op: 'audio', codec: 'aac' },
      { stage: 'container', op: 'format', ext: 'gif' },
    ]);
    expect(args).not.toContain('-c:a');
    expect(args).toContain('-an');
  });

  it('falls back to a real encode for h264/aac into WebM', () => {
    const job = compile([{ ...withAudio, videoCodec: 'h264', audioCodec: 'aac' }], [
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'encode', op: 'audio', codec: 'copy' },
      { stage: 'container', op: 'format', ext: 'webm' },
    ]);
    expect(valueOf(job.passes[0]!, '-c:v')).toBe('libvpx-vp9');
    expect(valueOf(job.passes[0]!, '-c:a')).toBe('libopus');
    expect(job.reencode).toBe(true);
  });
});

describe('no shell, ever', () => {
  it('keeps a hostile filename as exactly one argv entry', () => {
    const hostile = "in'; rm -rf / ;$(whoami) [x].mp4";
    const args = argsFor({ ...withAudio, fsName: hostile }, [
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(args.filter((a) => a === hostile)).toHaveLength(1);
    expect(args[args.indexOf('-i') + 1]).toBe(hostile);
    // Nothing anywhere is a concatenation of the filename with something else.
    expect(args.some((a) => a !== hostile && a.includes('rm -rf'))).toBe(false);
  });
});
