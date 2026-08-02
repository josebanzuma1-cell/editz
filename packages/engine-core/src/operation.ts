/**
 * The engine-agnostic operation vocabulary.
 *
 * A tool's `buildOps()` returns `Operation[]`. `compile()` (M2) turns that into
 * an FFmpeg argv array, and both the wasm runner and the native runner consume
 * that same argv. This indirection is the reason trim is implemented once.
 *
 * Operations are *staged* rather than being filters only. A filter-only
 * vocabulary cannot express `-c:v libx264 -crf 28` or `-movflags +faststart`,
 * so every tool ends up smuggling raw flags around the abstraction and the
 * abstraction stops being worth having. The stage tells the compiler where in
 * the argv the operation lands:
 *
 *   input     → before `-i`  (seek, duration, loop)
 *   filter    → `-vf` / `-af` / `-filter_complex`
 *   stream    → mapping and dropping
 *   encode    → codec and rate control, after the filters
 *   container → muxer flags, last
 */

export type FfPreset =
  | 'ultrafast'
  | 'superfast'
  | 'veryfast'
  | 'faster'
  | 'fast'
  | 'medium'
  | 'slow'
  | 'slower';

/**
 * Containers we know how to write.
 *
 * Closed on purpose. `ext: string` accepts `'mp3'` where `'mp4'` was meant and
 * the mistake survives all the way to a downloaded file with the wrong
 * extension — no test catches it, because a manifest's `outputExtension` would
 * carry the same typo. Adding a container means adding it here and to the
 * compatibility tables in compile.ts, which is exactly the review you want.
 */
export type ContainerExt =
  | 'mp4'
  | 'mov'
  | 'm4v'
  | 'mkv'
  | 'webm'
  | 'avi'
  | 'gif'
  | 'mp3'
  | 'm4a'
  | 'opus'
  | 'flac'
  | 'wav'
  | 'jpg'
  | 'png'
  | 'webp'
  | 'avif';

export type VideoCodec = 'h264' | 'h265' | 'vp9' | 'av1' | 'copy';
export type AudioCodec = 'aac' | 'opus' | 'mp3' | 'flac' | 'copy';
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif';

export type Operation =
  // --- input stage ---
  | { stage: 'input'; op: 'seek'; startSec: number }
  | { stage: 'input'; op: 'duration'; seconds: number }
  | { stage: 'input'; op: 'loop'; count: number }
  | { stage: 'input'; op: 'framerateIn'; fps: number }

  // --- filter stage ---
  /** `-2` on either axis means "keep the aspect ratio, round to even". */
  | { stage: 'filter'; op: 'scale'; width: number; height: number; flags?: 'lanczos' | 'bicubic' }
  | { stage: 'filter'; op: 'fit'; width: number; height: number; mode: 'contain' | 'cover' }
  | { stage: 'filter'; op: 'crop'; x: number; y: number; width: number; height: number }
  | { stage: 'filter'; op: 'pad'; width: number; height: number; color: string }
  /** Composite over a solid colour. Needed whenever transparency is being
   *  written to a format that cannot store it. */
  | { stage: 'filter'; op: 'flatten'; color: string }
  | { stage: 'filter'; op: 'fps'; fps: number }
  | { stage: 'filter'; op: 'transpose'; direction: 'cw' | 'ccw' | 'hflip' | 'vflip' | '180' }
  | {
      stage: 'filter';
      op: 'eq';
      brightness?: number;
      contrast?: number;
      saturation?: number;
      gamma?: number;
    }
  | { stage: 'filter'; op: 'colorPreset'; preset: string }
  /** Video speed. `factor` > 1 is faster. Audio is handled by `atempo`. */
  | { stage: 'filter'; op: 'setpts'; factor: number }
  | { stage: 'filter'; op: 'atempo'; factor: number }
  | { stage: 'filter'; op: 'reverse'; audio: boolean }
  | { stage: 'filter'; op: 'volume'; gainDb: number }
  | { stage: 'filter'; op: 'fade'; kind: 'in' | 'out'; startSec: number; durationSec: number }
  | { stage: 'filter'; op: 'drawText'; text: string; position: TextPosition; sizePx: number; color: string; boxColor?: string }
  | { stage: 'filter'; op: 'subtitles'; path: string; burnIn: boolean }
  | { stage: 'filter'; op: 'palette'; colors: number; dither: boolean }

  // --- stream stage ---
  | { stage: 'stream'; op: 'dropAudio' }
  | { stage: 'stream'; op: 'dropVideo' }
  | { stage: 'stream'; op: 'concat'; count: number; reencode: boolean }
  | { stage: 'stream'; op: 'mixAudio'; sources: number; duckOriginalDb?: number }

  // --- encode stage ---
  | {
      stage: 'encode';
      op: 'video';
      codec: VideoCodec;
      crf?: number;
      bitrateKbps?: number;
      maxrateKbps?: number;
      preset?: FfPreset;
      /** Two-pass rate control, used when a tool targets an exact file size. */
      pass?: 1 | 2;
    }
  | { stage: 'encode'; op: 'audio'; codec: AudioCodec; bitrateKbps?: number; sampleRateHz?: number }
  | { stage: 'encode'; op: 'image'; format: ImageFormat; quality?: number; dpi?: number }

  // --- container stage ---
  | { stage: 'container'; op: 'format'; ext: ContainerExt; faststart?: boolean }
  | { stage: 'container'; op: 'segment'; seconds: number };

export type TextPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export type OperationStage = Operation['stage'];

export function isStage<S extends OperationStage>(
  stage: S,
): (op: Operation) => op is Extract<Operation, { stage: S }> {
  return (op): op is Extract<Operation, { stage: S }> => op.stage === stage;
}
