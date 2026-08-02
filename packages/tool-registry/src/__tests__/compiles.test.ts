import { describe, expect, it } from 'vitest';
import { compile, type CompileInput } from '@editz/engine-core';
import { TOOLS } from '../index';

/**
 * The seam test: every manifest in the registry has to produce operations the
 * compiler can actually turn into a command.
 *
 * `buildOps` and `compile` are written in different packages and it is entirely
 * possible to add a tool that emits a well-typed operation nothing knows how to
 * compile. That failure would otherwise surface as a broken job in production
 * rather than as a red test here.
 */

const MB = 1024 * 1024;

const FIXTURES: Record<string, (index: number) => CompileInput> = {
  video: (i) => ({
    name: `clip${i}.mp4`,
    fsName: `input${i}.mp4`,
    bytes: 40 * MB,
    mime: 'video/mp4',
    kind: 'video',
    durationSec: 92,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
  }),
  audio: (i) => ({
    name: `note${i}.mp3`,
    fsName: `input${i}.mp3`,
    bytes: 4 * MB,
    mime: 'audio/mpeg',
    kind: 'audio',
    durationSec: 180,
    hasAudio: true,
  }),
  image: (i) => ({
    name: `photo${i}.jpg`,
    fsName: `input${i}.jpg`,
    bytes: 3 * MB,
    mime: 'image/jpeg',
    kind: 'image',
    width: 4032,
    height: 3024,
  }),
};

function inputsFor(kind: string, multiFile: boolean): CompileInput[] {
  const make = FIXTURES[kind] ?? FIXTURES.video!;
  return multiFile ? [make(0), make(1)] : [make(0)];
}

describe('every manifest compiles', () => {
  for (const tool of TOOLS) {
    describe(tool.slug, () => {
      const inputs = inputsFor(tool.kind, tool.multiFile);
      const ops = tool.buildOps(inputs[0]!, tool.defaults, inputs);

      // The editor compiles a timeline rather than a single input, and the
      // transcription tools produce text, not media. Both correctly emit no
      // FFmpeg operations at all.
      const isFfmpegJob = ops.length > 0;

      it('produces operations the compiler accepts', () => {
        if (!isFfmpegJob) return;
        expect(() => compile(inputs, ops)).not.toThrow();
      });

      it('emits an argv, never a shell string', () => {
        if (!isFfmpegJob) return;
        const job = compile(inputs, ops);
        expect(job.passes.length).toBeGreaterThan(0);
        for (const pass of job.passes) {
          expect(pass.length).toBeGreaterThan(3);
          for (const arg of pass) expect(typeof arg).toBe('string');
        }
      });

      it('agrees with its own outputExtension', () => {
        if (!isFfmpegJob) return;
        const job = compile(inputs, ops);
        const declared = tool.outputExtension(tool.defaults, inputs[0]!);
        expect(job.outputName, tool.slug).toContain(`.${declared}`);
      });

      it('reads the input from the filesystem name the runner assigned', () => {
        if (!isFfmpegJob) return;
        const job = compile(inputs, ops);
        const flat = job.passes[0]!.join(' ');
        // Either a direct -i, or a concat list naming the same files.
        const named =
          flat.includes(inputs[0]!.fsName) ||
          job.auxFiles.some((file) => file.content.includes(inputs[0]!.fsName));
        expect(named, tool.slug).toBe(true);
      });
    });
  }
});

describe('execution policy lines up with what the compiler produces', () => {
  it('marks every tool that buffers the whole file as needing care', () => {
    // reverse-video is the one operation that genuinely cannot stream. Its
    // manifest sets a much lower client ceiling; if that ever diverges from
    // what the compiler reports, one of the two is wrong.
    for (const tool of TOOLS) {
      const inputs = inputsFor(tool.kind, tool.multiFile);
      const ops = tool.buildOps(inputs[0]!, tool.defaults, inputs);
      if (ops.length === 0) continue;

      const job = compile(inputs, ops);
      if (job.needsFullBuffer) {
        expect(tool.clientCeilingBytes, `${tool.slug} buffers but has no lowered ceiling`)
          .toBeDefined();
      }
    }
  });
});
