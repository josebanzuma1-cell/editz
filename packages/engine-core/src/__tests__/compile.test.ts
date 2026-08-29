import { describe, expect, it } from 'vitest';
import { atempoChain, compile, type CompileInput } from '../compile';
import { CompileError, type CompileNoteCode } from '../notes';
import type { Operation } from '../operation';

const MB = 1024 * 1024;

function video(overrides: Partial<CompileInput> = {}): CompileInput {
  return {
    name: 'clip.mp4',
    fsName: 'input0.mp4',
    bytes: 40 * MB,
    mime: 'video/mp4',
    kind: 'video',
    durationSec: 92,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    ...overrides,
  };
}

/** Reads the value that follows a flag, so tests assert on meaning rather than
 *  on argv position. */
function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

const codes = (job: { notes: { code: CompileNoteCode }[] }) => job.notes.map((n) => n.code);

describe('compile — shape', () => {
  it('never emits a shell string, only argv entries', () => {
    const job = compile([video()], [{ stage: 'container', op: 'format', ext: 'mp4' }]);
    expect(job.passes).toHaveLength(1);
    for (const arg of job.passes[0]!) expect(typeof arg).toBe('string');
  });

  it('puts the output filename last and names it in the result', () => {
    const job = compile([video()], [{ stage: 'container', op: 'format', ext: 'mkv' }]);
    expect(job.outputName).toBe('output.mkv');
    expect(job.passes[0]!.at(-1)).toBe('output.mkv');
  });

  it('honours a custom output base name', () => {
    const job = compile([video()], [{ stage: 'container', op: 'format', ext: 'mp4' }], {
      outputBaseName: 'trimmed',
    });
    expect(job.outputName).toBe('trimmed.mp4');
  });
});

describe('compile — seek and duration', () => {
  const trim: Operation[] = [
    { stage: 'input', op: 'seek', startSec: 5 },
    { stage: 'input', op: 'duration', seconds: 10 },
    { stage: 'encode', op: 'video', codec: 'copy' },
    { stage: 'encode', op: 'audio', codec: 'copy' },
    { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
  ];

  it('seeks before -i, which uses the index instead of decoding to the cut', () => {
    const args = compile([video()], trim).passes[0]!;
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(valueOf(args, '-ss')).toBe('5');
  });

  it('uses -t rather than -to, which is ambiguous after a pre-input seek', () => {
    const args = compile([video()], trim).passes[0]!;
    expect(args).not.toContain('-to');
    expect(valueOf(args, '-t')).toBe('10');
    expect(args.indexOf('-t')).toBeGreaterThan(args.indexOf('-i'));
  });

  it('scales the output duration when the clip is also sped up', () => {
    const args = compile([video()], [
      ...trim,
      { stage: 'filter', op: 'setpts', factor: 2 },
    ]).passes[0]!;
    // 10 seconds of source at 2x is 5 seconds of output.
    expect(valueOf(args, '-t')).toBe('5');
  });

  it('warns that a stream-copy cut lands on a keyframe', () => {
    expect(codes(compile([video()], trim))).toContain('cut-is-keyframe-aligned');
  });

  it('does not warn about keyframes when it is re-encoding, because it is exact', () => {
    const exact = compile([video()], [
      ...trim.slice(0, 2),
      { stage: 'encode', op: 'video', codec: 'h264', crf: 20 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(codes(exact)).not.toContain('cut-is-keyframe-aligned');
  });

  describe('degenerate ranges', () => {
    // FFmpeg given an empty range exits 0 and writes a header-only file, so
    // the job reports success and the user downloads something unplayable.
    it('rejects a zero-length range', () => {
      expect(() =>
        compile([video()], [
          { stage: 'input', op: 'seek', startSec: 5 },
          { stage: 'input', op: 'duration', seconds: 0 },
        ]),
      ).toThrowError(CompileError);
    });

    it('reports the reason as a code, not a sentence', () => {
      try {
        compile([video()], [{ stage: 'input', op: 'duration', seconds: 0 }]);
        expect.unreachable();
      } catch (error) {
        expect((error as CompileError).code).toBe('range-empty');
      }
    });

    it('rejects a start beyond the end of the file', () => {
      try {
        compile([video({ durationSec: 30 })], [{ stage: 'input', op: 'seek', startSec: 45 }]);
        expect.unreachable();
      } catch (error) {
        expect((error as CompileError).code).toBe('range-starts-after-end');
      }
    });

    it('rejects a non-finite range', () => {
      try {
        compile([video()], [{ stage: 'input', op: 'seek', startSec: Number.NaN }]);
        expect.unreachable();
      } catch (error) {
        expect((error as CompileError).code).toBe('range-invalid');
      }
    });
  });
});

describe('compile — codec resolution', () => {
  // The reviewed implementation computed `reencode` before the container
  // compatibility fallback ran, so this exact job reported "no re-encode" while
  // emitting -c:v libvpx-vp9. `reencode` drives the UI estimate, so it told the
  // user a four-minute VP9 encode would be instant.
  it('reports a re-encode when the container cannot carry the source track', () => {
    const job = compile([video({ videoCodec: 'h264', audioCodec: 'aac' })], [
      { stage: 'container', op: 'format', ext: 'webm' },
    ]);
    expect(valueOf(job.passes[0]!, '-c:v')).toBe('libvpx-vp9');
    expect(job.reencode).toBe(true);
    expect(codes(job)).toContain('container-forces-video-reencode');
  });

  it('drops rate-control flags the substituted encoder cannot take', () => {
    // h264 + preset into a WebM: the encoder becomes libvpx-vp9, which has no
    // `preset` option and exits non-zero if handed one.
    const job = compile([video()], [
      { stage: 'encode', op: 'video', codec: 'h264', crf: 30, preset: 'medium' },
      { stage: 'container', op: 'format', ext: 'webm' },
    ]);
    expect(valueOf(job.passes[0]!, '-c:v')).toBe('libvpx-vp9');
    expect(job.passes[0]).not.toContain('-preset');
    expect(codes(job)).toContain('encoder-options-dropped');
  });

  it('keeps the preset when the encoder does accept it', () => {
    const job = compile([video()], [
      { stage: 'encode', op: 'video', codec: 'h264', crf: 27, preset: 'medium' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(valueOf(job.passes[0]!, '-preset')).toBe('medium');
  });

  it('adds -b:v 0 for VP9, which otherwise ignores -crf entirely', () => {
    const job = compile([video()], [
      { stage: 'encode', op: 'video', codec: 'vp9', crf: 33 },
      { stage: 'container', op: 'format', ext: 'webm' },
    ]);
    expect(valueOf(job.passes[0]!, '-b:v')).toBe('0');
    expect(codes(job)).toContain('vp9-crf-needs-zero-bitrate');
  });

  it('copies the stream when writing back the same container', () => {
    // No ffprobe in a browser, so there is no source codec to check. Writing
    // MP4 from MP4 is copy-safe regardless, and without this every `copy` tool
    // would re-encode on the client.
    const job = compile([video()], [
      { stage: 'stream', op: 'dropAudio' },
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
    ]);
    expect(valueOf(job.passes[0]!, '-c:v')).toBe('copy');
    expect(job.reencode).toBe(false);
  });

  it('never gambles on an unknown source codec into a different container', () => {
    const job = compile([video({ fsName: 'input0.avi', mime: 'video/x-msvideo' })], [
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(valueOf(job.passes[0]!, '-c:v')).toBe('libx264');
  });

  it('does not re-encode the picture just because the sound changed', () => {
    // An audio filter is not a reason to touch a single pixel. Deriving one
    // "does this re-encode?" answer from the operation list alone conflates
    // the two chains and turns a stream copy into a CPU-bound job.
    const job = compile([video()], [
      { stage: 'filter', op: 'volume', gainDb: -6 },
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 192 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(valueOf(job.passes[0]!, '-c:v')).toBe('copy');
    expect(valueOf(job.passes[0]!, '-c:a')).toBe('aac');
    expect(valueOf(job.passes[0]!, '-af')).toContain('volume=-6dB');
    expect(job.reencode).toBe(false);
  });

  it('re-encodes when a filter is present, because copy plus a filter is fatal', () => {
    const job = compile([video()], [
      { stage: 'filter', op: 'crop', x: 0, y: 0, width: 640, height: 480 },
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(valueOf(job.passes[0]!, '-c:v')).not.toBe('copy');
    expect(codes(job)).toContain('filter-forces-reencode');
  });

  it('writes no video stream for a source that has none', () => {
    // An .mp4 carrying only a podcast is a real thing people upload, and
    // `-c:v` on it fails outright.
    const job = compile([video({ hasVideo: false })], [
      { stage: 'encode', op: 'video', codec: 'h264', crf: 23 },
      { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 128 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(job.passes[0]).toContain('-vn');
    expect(job.passes[0]).not.toContain('-c:v');
    expect(job.reencode).toBe(false);
  });

  it('writes no video stream at all for an audio-only container', () => {
    const job = compile([video()], [
      { stage: 'encode', op: 'audio', codec: 'mp3', bitrateKbps: 192 },
      { stage: 'container', op: 'format', ext: 'mp3' },
    ]);
    expect(job.passes[0]).toContain('-vn');
    expect(job.passes[0]).not.toContain('-c:v');
  });
});

describe('compile — even dimensions', () => {
  // H.264 and H.265 reject odd width or height outright. The reviewed guard
  // only fired when a filter already existed, which misses the container-swap
  // path — the one case that arrives with an empty filter chain and a real
  // encoder.
  it('snaps to even when re-encoding with no filters at all', () => {
    // A container swap arrives here with an empty filter chain and a real
    // encoder. The reviewed guard was gated on a filter already existing, so
    // this 1279x721 job failed with "width not divisible by 2".
    const job = compile([video({ width: 1279, height: 721, fsName: 'input0.mov' })], [
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(valueOf(job.passes[0]!, '-vf')).toContain('trunc(iw/2)*2');
    expect(codes(job)).toContain('dimensions-rounded-to-even');
  });

  it('appends the guard after the tool own filters, not before', () => {
    const job = compile([video()], [
      { stage: 'filter', op: 'scale', width: 641, height: -2 },
      { stage: 'encode', op: 'video', codec: 'h264', crf: 23 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    const chain = valueOf(job.passes[0]!, '-vf')!;
    expect(chain.indexOf('scale=641')).toBeLessThan(chain.indexOf('trunc(iw/2)*2'));
  });

  it('does not bother for encoders that accept odd dimensions', () => {
    const job = compile([video({ width: 1279, height: 721 })], [
      { stage: 'encode', op: 'video', codec: 'vp9', crf: 33 },
      { stage: 'container', op: 'format', ext: 'webm' },
    ]);
    expect(valueOf(job.passes[0]!, '-vf') ?? '').not.toContain('trunc');
  });

  it('stays quiet when the source was already even', () => {
    const job = compile([video({ width: 1920, height: 1080 })], [
      { stage: 'encode', op: 'video', codec: 'h264', crf: 23 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(codes(job)).not.toContain('dimensions-rounded-to-even');
  });
});

describe('atempoChain', () => {
  // atempo only accepts 0.5–2.0. Getting this wrong is the classic speed-tool
  // bug: the picture changes tempo and the audio silently does not.
  it('passes a factor inside the range straight through', () => {
    expect(atempoChain(1.5)).toEqual(['atempo=1.5']);
  });

  it('emits nothing at all for 1x', () => {
    expect(atempoChain(1)).toEqual([]);
  });

  it('chains above 2x', () => {
    expect(atempoChain(4)).toEqual(['atempo=2.0', 'atempo=2']);
    expect(atempoChain(3)).toEqual(['atempo=2.0', 'atempo=1.5']);
  });

  it('chains below 0.5x', () => {
    expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5']);
  });

  it('multiplies back out to the requested factor', () => {
    for (const factor of [0.25, 0.4, 0.5, 0.75, 1.5, 2, 2.5, 3, 4]) {
      const product = atempoChain(factor).reduce(
        (acc, part) => acc * Number(part.split('=')[1]),
        1,
      );
      expect(product).toBeCloseTo(factor, 5);
    }
  });
});

describe('compile — filters', () => {
  it('maps rotation to transpose', () => {
    const cw = compile([video()], [{ stage: 'filter', op: 'transpose', direction: 'cw' }]);
    expect(valueOf(cw.passes[0]!, '-vf')).toContain('transpose=1');

    const half = compile([video()], [{ stage: 'filter', op: 'transpose', direction: '180' }]);
    expect(valueOf(half.passes[0]!, '-vf')).toContain('transpose=1,transpose=1');
  });

  it('letterboxes for contain and crops for cover', () => {
    const contain = compile([video()], [
      { stage: 'filter', op: 'fit', width: 1080, height: 1080, mode: 'contain' },
    ]);
    expect(valueOf(contain.passes[0]!, '-vf')).toContain('force_original_aspect_ratio=decrease');
    expect(valueOf(contain.passes[0]!, '-vf')).toContain('pad=1080:1080');

    const cover = compile([video()], [
      { stage: 'filter', op: 'fit', width: 1080, height: 1080, mode: 'cover' },
    ]);
    expect(valueOf(cover.passes[0]!, '-vf')).toContain('crop=1080:1080');
  });

  it('rejects a scale with neither dimension given', () => {
    try {
      compile([video()], [{ stage: 'filter', op: 'scale', width: -2, height: -2 }]);
      expect.unreachable();
    } catch (error) {
      expect((error as CompileError).code).toBe('scale-needs-a-dimension');
    }
  });

  it('flags reverse as needing the whole file in memory', () => {
    const job = compile([video()], [{ stage: 'filter', op: 'reverse', audio: true }]);
    expect(job.needsFullBuffer).toBe(true);
    expect(codes(job)).toContain('buffers-whole-file');
    expect(valueOf(job.passes[0]!, '-af')).toContain('areverse');
  });

  it('treats fade as audio on an audio-only file', () => {
    const job = compile([{ ...video(), kind: 'audio', fsName: 'input0.mp3', mime: 'audio/mpeg' }], [
      { stage: 'filter', op: 'fade', kind: 'in', startSec: 0, durationSec: 0.05 },
      { stage: 'encode', op: 'audio', codec: 'mp3', bitrateKbps: 192 },
      { stage: 'container', op: 'format', ext: 'mp3' },
    ]);
    expect(valueOf(job.passes[0]!, '-af')).toContain('afade=t=in');
  });

  it('writes drawtext copy to a file instead of into the filtergraph', () => {
    // Two levels of escaping and the only user-typed string that would reach
    // an argv. textfile= removes the problem rather than managing it.
    const job = compile([video()], [
      {
        stage: 'filter',
        op: 'drawText',
        text: "it's 100%: a:b, [weird]\\",
        position: 'top',
        sizePx: 48,
        color: 'white',
      },
    ]);
    expect(job.auxFiles).toEqual([{ name: 'text0.txt', content: "it's 100%: a:b, [weird]\\" }]);
    const chain = valueOf(job.passes[0]!, '-vf')!;
    expect(chain).toContain('textfile=text0.txt');
    expect(chain).not.toContain('weird');
  });
});

describe('compile — filter_complex graphs', () => {
  it('builds a two-pass palette for GIF', () => {
    const job = compile([video()], [
      { stage: 'filter', op: 'fps', fps: 15 },
      { stage: 'filter', op: 'scale', width: 480, height: -2 },
      { stage: 'filter', op: 'palette', colors: 256, dither: true },
      { stage: 'stream', op: 'dropAudio' },
      { stage: 'container', op: 'format', ext: 'gif' },
    ]);
    const graph = valueOf(job.passes[0]!, '-filter_complex')!;
    expect(graph).toContain('palettegen');
    expect(graph).toContain('paletteuse');
    expect(graph).toContain('fps=15');
    expect(job.passes[0]).not.toContain('-vf');
    expect(valueOf(job.passes[0]!, '-loop')).toBe('0');
  });

  it('uses the concat demuxer for a lossless join', () => {
    const inputs = [video({ fsName: 'input0.mp4' }), video({ fsName: 'input1.mp4' })];
    const job = compile(inputs, [
      { stage: 'stream', op: 'concat', count: 2, reencode: false },
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(job.passes[0]).toContain('concat');
    expect(job.auxFiles).toContainEqual({
      name: 'concat.txt',
      content: "file 'input0.mp4'\nfile 'input1.mp4'\n",
    });
  });

  it('uses the concat filter when the clips have to be normalised', () => {
    const inputs = [video({ fsName: 'input0.mp4' }), video({ fsName: 'input1.mov' })];
    const job = compile(inputs, [
      { stage: 'stream', op: 'concat', count: 2, reencode: true },
      { stage: 'encode', op: 'video', codec: 'h264', crf: 23 },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    const graph = valueOf(job.passes[0]!, '-filter_complex')!;
    expect(graph).toContain('concat=n=2:v=1:a=1');
    expect(job.passes[0]!.filter((a) => a === '-i')).toHaveLength(2);
  });

  it('refuses to join more files than it was given', () => {
    try {
      compile([video()], [{ stage: 'stream', op: 'concat', count: 3, reencode: true }]);
      expect.unreachable();
    } catch (error) {
      expect((error as CompileError).code).toBe('multi-input-required');
    }
  });

  it('ducks the original track when mixing music over it', () => {
    const inputs = [video({ fsName: 'input0.mp4' }), video({ fsName: 'input1.mp3' })];
    const job = compile(inputs, [
      { stage: 'stream', op: 'mixAudio', sources: 2, duckOriginalDb: -6 },
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    const graph = valueOf(job.passes[0]!, '-filter_complex')!;
    expect(graph).toContain('volume=-6dB');
    expect(graph).toContain('amix=inputs=2');
  });

  it('refuses two filter_complex graphs at once rather than emitting a broken one', () => {
    try {
      compile([video(), video({ fsName: 'input1.mp4' })], [
        { stage: 'stream', op: 'concat', count: 2, reencode: true },
        { stage: 'filter', op: 'palette', colors: 256, dither: true },
      ]);
      expect.unreachable();
    } catch (error) {
      expect((error as CompileError).code).toBe('unsupported-operation');
    }
  });
});

describe('compile — containers and output', () => {
  it('moves the index to the front so the file streams', () => {
    const job = compile([video()], [
      { stage: 'encode', op: 'video', codec: 'h264', crf: 23 },
      { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
    ]);
    expect(valueOf(job.passes[0]!, '-movflags')).toBe('+faststart');
  });

  it('does not try to move an index a container does not have', () => {
    const job = compile([video()], [
      { stage: 'encode', op: 'video', codec: 'h264', crf: 23 },
      { stage: 'container', op: 'format', ext: 'mkv', faststart: true },
    ]);
    expect(job.passes[0]).not.toContain('-movflags');
  });

  it('names segmented output with a pattern', () => {
    const job = compile([video()], [
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'container', op: 'format', ext: 'mp4' },
      { stage: 'container', op: 'segment', seconds: 30 },
    ]);
    expect(job.outputName).toBe('output_%03d.mp4');
    expect(valueOf(job.passes[0]!, '-segment_time')).toBe('30');
    expect(valueOf(job.passes[0]!, '-reset_timestamps')).toBe('1');
  });

  it('repeats with -stream_loop, which counts extra passes not total plays', () => {
    const job = compile([video()], [
      { stage: 'input', op: 'loop', count: 3 },
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'container', op: 'format', ext: 'mp4' },
    ]);
    expect(valueOf(job.passes[0]!, '-stream_loop')).toBe('2');
  });
});

describe('compile — images', () => {
  const photo = (): CompileInput => ({
    name: 'photo.jpg',
    fsName: 'input0.jpg',
    bytes: 3 * MB,
    mime: 'image/jpeg',
    kind: 'image',
    width: 4032,
    height: 3024,
  });

  it('takes the container from the image format when no container op is given', () => {
    const job = compile([photo()], [
      { stage: 'filter', op: 'fit', width: 1080, height: 1080, mode: 'contain' },
      { stage: 'encode', op: 'image', format: 'jpeg', quality: 85 },
    ]);
    expect(job.outputName).toBe('output.jpg');
    expect(valueOf(job.passes[0]!, '-c:v')).toBe('mjpeg');
    expect(valueOf(job.passes[0]!, '-frames:v')).toBe('1');
  });

  it('converts percent quality to the -q:v scale, which runs the other way', () => {
    const best = compile([photo()], [{ stage: 'encode', op: 'image', format: 'jpeg', quality: 100 }]);
    const worst = compile([photo()], [{ stage: 'encode', op: 'image', format: 'jpeg', quality: 40 }]);
    expect(Number(valueOf(best.passes[0]!, '-q:v'))).toBeLessThan(
      Number(valueOf(worst.passes[0]!, '-q:v')),
    );
    expect(Number(valueOf(best.passes[0]!, '-q:v'))).toBeGreaterThanOrEqual(2);
    expect(Number(valueOf(worst.passes[0]!, '-q:v'))).toBeLessThanOrEqual(31);
  });

  it('composites transparency onto a colour, since JPEG cannot store it', () => {
    const job = compile([photo()], [
      { stage: 'filter', op: 'flatten', color: 'white' },
      { stage: 'encode', op: 'image', format: 'jpeg', quality: 90 },
    ]);
    expect(valueOf(job.passes[0]!, '-filter_complex')).toContain('color=white');
    expect(valueOf(job.passes[0]!, '-filter_complex')).toContain('overlay');
  });

  it('hands DPI back to the runner, because FFmpeg cannot write it', () => {
    const job = compile([photo()], [
      { stage: 'encode', op: 'image', format: 'jpeg', quality: 95, dpi: 300 },
    ]);
    expect(job.postProcess).toEqual({ setDpi: 300 });
  });
});
