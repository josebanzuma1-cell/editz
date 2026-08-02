import type { MediaInput } from './media';
import type {
  AudioCodec,
  ContainerExt,
  ImageFormat,
  Operation,
  TextPosition,
  VideoCodec,
} from './operation';
import { CompileError, type CompileNote } from './notes';

/* -------------------------------------------------------------------------- */
/* Public shape                                                                */
/* -------------------------------------------------------------------------- */

export interface CompileInput extends MediaInput {
  /**
   * The name this file has in the runner's filesystem.
   *
   * The runner assigns these (`input0.mp4`, `input1.mp4`) rather than reusing
   * the user's filename, which may collide across a merge, contain characters
   * the concat demuxer's list format cannot express, or simply be 200
   * characters of emoji. Nothing user-controlled reaches the argv.
   */
  fsName: string;
}

/** A file the runner must write before starting FFmpeg. */
export interface AuxFile {
  name: string;
  content: string;
}

export interface CompiledJob {
  /**
   * Argument arrays. Never a string — there is no shell and no injection
   * surface anywhere in this pipeline.
   *
   * Plural because targeting an exact output size is genuinely two-pass. Only
   * one pass is emitted today; the shape is here so that adding the second one
   * is not a change to every call site.
   */
  passes: string[][];
  /** What the last pass writes. */
  outputName: string;
  auxFiles: AuxFile[];
  /** True if pixels are re-encoded — slow and CPU-bound. Drives the estimate. */
  reencode: boolean;
  notes: CompileNote[];
  /** True if the job must hold the whole file in memory. Blocks client mode. */
  needsFullBuffer: boolean;
  /** Work FFmpeg cannot do, for the runner to apply afterwards. */
  postProcess?: { setDpi?: number };
}

export interface CompileOptions {
  outputBaseName?: string;
  /** Path to a font in the runner's filesystem. Required by drawtext. */
  fontFile?: string;
}

/* -------------------------------------------------------------------------- */
/* Container / codec tables                                                    */
/* -------------------------------------------------------------------------- */

const VIDEO_ENCODER: Record<VideoCodec, string> = {
  h264: 'libx264',
  h265: 'libx265',
  vp9: 'libvpx-vp9',
  av1: 'libaom-av1',
  copy: 'copy',
};

const AUDIO_ENCODER: Record<AudioCodec, string> = {
  aac: 'aac',
  mp3: 'libmp3lame',
  opus: 'libopus',
  flac: 'flac',
  copy: 'copy',
};

const IMAGE_ENCODER: Record<ImageFormat, string> = {
  jpeg: 'mjpeg',
  png: 'png',
  webp: 'libwebp',
  avif: 'libaom-av1',
};

/** What each encoder actually produces, for the container check below. */
const ENCODER_PRODUCES: Record<string, string> = {
  libx264: 'h264',
  libx265: 'hevc',
  'libvpx-vp9': 'vp9',
  'libaom-av1': 'av1',
  aac: 'aac',
  libmp3lame: 'mp3',
  libopus: 'opus',
  flac: 'flac',
  gif: 'gif',
};

/**
 * Which source codecs each container can legally carry. `null` means
 * "effectively anything" (Matroska); a missing entry means "cannot carry video
 * at all", which is also the safe answer for a container we do not recognise.
 *
 * Skipping this check produces "Could not write header (incorrect codec
 * parameters?)", which is FFmpeg's least helpful error message.
 */
const CONTAINER_VIDEO: Record<string, string[] | null> = {
  mp4: ['h264', 'hevc', 'h265', 'av1', 'mpeg4'],
  m4v: ['h264', 'hevc', 'mpeg4'],
  mov: ['h264', 'hevc', 'h265', 'prores', 'mpeg4'],
  mkv: null,
  webm: ['vp8', 'vp9', 'av1'],
  avi: ['h264', 'mpeg4', 'mjpeg'],
  gif: ['gif'],
};

/** Containers that cannot carry a video stream at all. Writing `-c:v` for one
 *  of these fails with "no video stream" on an audio-only job. */
const AUDIO_ONLY_CONTAINERS = new Set(['mp3', 'm4a', 'opus', 'flac', 'wav', 'aac', 'ogg']);

/** ...and the mirror image. The GIF muxer refuses a file with audio in it
 *  outright: "Could not write header — muxer does not support audio". */
const VIDEO_ONLY_CONTAINERS = new Set(['gif', 'jpg', 'png', 'webp', 'avif']);

/** Extensions that name the same container. */
const CONTAINER_ALIAS: Record<string, string> = { m4v: 'mp4', qt: 'mov', mpeg4: 'mp4' };

function containerOf(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const raw = name.slice(dot + 1).toLowerCase();
  return CONTAINER_ALIAS[raw] ?? raw;
}

const CONTAINER_AUDIO: Record<string, string[] | null> = {
  mp4: ['aac', 'mp3', 'ac3', 'alac'],
  m4a: ['aac', 'alac'],
  m4v: ['aac', 'mp3'],
  mov: ['aac', 'mp3', 'pcm_s16le', 'alac'],
  mkv: null,
  webm: ['opus', 'vorbis'],
  avi: ['mp3', 'ac3', 'pcm_s16le'],
  mp3: ['mp3'],
  opus: ['opus'],
  flac: ['flac'],
};

/** Sensible encoder when `copy` turns out to be illegal or a filter forces it. */
const FALLBACK_VIDEO: Record<string, string> = {
  webm: 'libvpx-vp9',
  avi: 'libx264',
  gif: 'gif',
};
const FALLBACK_AUDIO: Record<string, string> = {
  webm: 'libopus',
  mp3: 'libmp3lame',
  opus: 'libopus',
  flac: 'flac',
  avi: 'libmp3lame',
};

/** Encoders that hard-fail on odd width or height. */
const NEEDS_EVEN_DIMENSIONS = new Set(['libx264', 'libx265']);
/** Encoders with an x264-style `-preset`. Passing it to anything else errors. */
const ACCEPTS_PRESET = new Set(['libx264', 'libx265']);
/** Encoders that understand `-crf`. */
const ACCEPTS_CRF = new Set(['libx264', 'libx265', 'libvpx-vp9', 'libaom-av1']);

const COLOR_PRESETS: Record<string, string | null> = {
  none: null,
  grayscale: 'hue=s=0',
  sepia:
    'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
  warm: 'colorbalance=rs=.12:gs=.02:bs=-.12',
  cool: 'colorbalance=rs=-.12:bs=.12',
  vintage: 'curves=vintage',
  'high-contrast': 'eq=contrast=1.4:saturation=1.1',
};

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

function num(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

function copyIsLegal(allowed: string[] | null | undefined, sourceCodec?: string): boolean {
  if (allowed === null) return true; // mkv takes anything
  if (allowed === undefined || allowed.length === 0) return false;
  if (!sourceCodec) return false; // unknown source: never gamble
  return allowed.includes(sourceCodec.toLowerCase());
}

/**
 * atempo only accepts 0.5–2.0, so anything outside that range has to be
 * chained. Getting this wrong is the classic speed-tool bug: the picture
 * changes tempo and the audio silently does not.
 */
export function atempoChain(factor: number): string[] {
  const parts: string[] = [];
  let remaining = factor;
  while (remaining > 2) {
    parts.push('atempo=2.0');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    parts.push('atempo=0.5');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 1e-6) parts.push(`atempo=${num(remaining)}`);
  return parts;
}

const TEXT_POSITION: Record<TextPosition, string> = {
  'top-left': 'x=w*0.04:y=h*0.05',
  top: 'x=(w-text_w)/2:y=h*0.05',
  'top-right': 'x=w-text_w-w*0.04:y=h*0.05',
  center: 'x=(w-text_w)/2:y=(h-text_h)/2',
  'bottom-left': 'x=w*0.04:y=h-text_h-h*0.05',
  bottom: 'x=(w-text_w)/2:y=h-text_h-h*0.05',
  'bottom-right': 'x=w-text_w-w*0.04:y=h-text_h-h*0.05',
};

/** JPEG's -q:v runs 2 (best) to 31 (worst); the UI works in percent. */
function jpegQuality(quality: number): number {
  const clamped = Math.min(100, Math.max(1, quality));
  return Math.min(31, Math.max(2, Math.round(31 - (clamped / 100) * 29)));
}

/* -------------------------------------------------------------------------- */
/* The compiler                                                                */
/* -------------------------------------------------------------------------- */

interface VideoIntent {
  codec: VideoCodec;
  crf?: number;
  bitrateKbps?: number;
  maxrateKbps?: number;
  preset?: string;
}

interface AudioIntent {
  codec: AudioCodec;
  bitrateKbps?: number;
  sampleRateHz?: number;
}

type ComplexMode = 'concat' | 'mix' | 'palette' | 'flatten';

/**
 * Only one filter_complex graph can own the stream, so a tool asking for two
 * of them is a manifest bug, not something to paper over at runtime.
 *
 * Written as a pure function rather than a closure because TypeScript stops
 * narrowing a `let` that is only ever assigned inside a nested function — the
 * switch below would see `null` and nothing else.
 */
function claimComplex(current: ComplexMode | null, next: ComplexMode): ComplexMode {
  if (current !== null && current !== next) {
    throw new CompileError('unsupported-operation', { combination: `${current}+${next}` });
  }
  return next;
}

export function compile(
  inputs: readonly CompileInput[],
  ops: readonly Operation[],
  options: CompileOptions = {},
): CompiledJob {
  const primary = inputs[0];
  if (!primary) throw new CompileError('multi-input-required', { needed: 1, given: 0 });

  const base = options.outputBaseName ?? 'output';
  const notes: CompileNote[] = [];
  const auxFiles: AuxFile[] = [];

  const preInput: string[] = [];
  const extraInputs: string[] = [];
  const vf: string[] = [];
  const af: string[] = [];

  let ext: ContainerExt = 'mp4';
  let containerSet = false;
  let faststart = false;
  let segmentSeconds: number | null = null;
  let dropAudio = false;
  let dropVideo = false;
  let needsFullBuffer = false;
  let speedFactor = 1;
  let seekStart: number | null = null;
  let durationSec: number | null = null;
  let dpi: number | null = null;

  let videoIntent: VideoIntent | null = null;
  let audioIntent: AudioIntent | null = null;
  let imageFormat: ImageFormat | null = null;
  let imageQuality: number | null = null;

  let complex: ComplexMode | null = null;
  let concatCount = 0;
  let concatReencode = true;
  let mixSources = 0;
  let mixDuckDb: number | undefined;
  let paletteColors = 256;
  let paletteDither = true;
  let flattenColor = 'white';

  for (const op of ops) {
    switch (op.stage) {
      case 'input':
        switch (op.op) {
          case 'seek':
            seekStart = op.startSec;
            break;
          case 'duration':
            durationSec = op.seconds;
            break;
          case 'loop':
            // -stream_loop counts *additional* passes, so N plays is N-1.
            if (op.count > 1) preInput.push('-stream_loop', String(op.count - 1));
            break;
          case 'framerateIn':
            preInput.push('-framerate', num(op.fps));
            break;
        }
        break;

      case 'filter':
        switch (op.op) {
          case 'scale': {
            if (op.width < 0 && op.height < 0) {
              throw new CompileError('scale-needs-a-dimension');
            }
            const flags = op.flags ? `:flags=${op.flags}` : '';
            vf.push(`scale=${op.width}:${op.height}${flags}`);
            break;
          }
          case 'fit':
            vf.push(
              op.mode === 'contain'
                ? `scale=${op.width}:${op.height}:force_original_aspect_ratio=decrease,` +
                    `pad=${op.width}:${op.height}:(ow-iw)/2:(oh-ih)/2:color=black`
                : `scale=${op.width}:${op.height}:force_original_aspect_ratio=increase,` +
                    `crop=${op.width}:${op.height}`,
            );
            break;
          case 'crop': {
            // A crop box dragged past the edge of the frame is FFmpeg's
            // problem to reject and ours to prevent. Clamp while we still know
            // the frame size; when we do not, pass it through and let the
            // filter's own clamping deal with it.
            let { x, y, width: cw, height: ch } = op;
            if (primary.width !== undefined) {
              cw = Math.min(cw, primary.width);
              x = Math.max(0, Math.min(x, primary.width - cw));
            }
            if (primary.height !== undefined) {
              ch = Math.min(ch, primary.height);
              y = Math.max(0, Math.min(y, primary.height - ch));
            }
            if (cw !== op.width || ch !== op.height || x !== op.x || y !== op.y) {
              notes.push({ code: 'crop-clamped-to-frame' });
            }
            vf.push(`crop=${cw}:${ch}:${x}:${y}`);
            break;
          }
          case 'pad':
            vf.push(`pad=${op.width}:${op.height}:(ow-iw)/2:(oh-ih)/2:color=${op.color}`);
            break;
          case 'flatten':
            complex = claimComplex(complex, 'flatten');
            flattenColor = op.color;
            break;
          case 'fps':
            vf.push(`fps=${num(op.fps)}`);
            break;
          case 'transpose':
            vf.push(
              op.direction === 'cw'
                ? 'transpose=1'
                : op.direction === 'ccw'
                  ? 'transpose=2'
                  : op.direction === '180'
                    ? 'transpose=1,transpose=1'
                    : op.direction === 'hflip'
                      ? 'hflip'
                      : 'vflip',
            );
            break;
          case 'eq': {
            const parts: string[] = [];
            if (op.brightness !== undefined) parts.push(`brightness=${num(op.brightness)}`);
            if (op.contrast !== undefined) parts.push(`contrast=${num(op.contrast)}`);
            if (op.saturation !== undefined) parts.push(`saturation=${num(op.saturation)}`);
            if (op.gamma !== undefined) parts.push(`gamma=${num(op.gamma)}`);
            if (parts.length) vf.push(`eq=${parts.join(':')}`);
            break;
          }
          case 'colorPreset': {
            const filter = COLOR_PRESETS[op.preset];
            if (filter === undefined) {
              throw new CompileError('unsupported-operation', { preset: op.preset });
            }
            if (filter !== null) vf.push(filter);
            break;
          }
          case 'setpts':
            speedFactor = op.factor;
            vf.push(`setpts=${num(1 / op.factor)}*PTS`);
            break;
          case 'atempo':
            af.push(...atempoChain(op.factor));
            break;
          case 'reverse':
            vf.push('reverse');
            if (op.audio) af.push('areverse');
            needsFullBuffer = true;
            notes.push({ code: 'buffers-whole-file' });
            break;
          case 'volume':
            af.push(`volume=${num(op.gainDb)}dB`);
            break;
          case 'fade': {
            // cut-audio fades an audio-only file; a video tool fades pictures.
            const audioOnly = primary.kind === 'audio' || dropVideo;
            const filter = `${audioOnly ? 'afade' : 'fade'}=t=${op.kind}:st=${num(op.startSec)}:d=${num(op.durationSec)}`;
            (audioOnly ? af : vf).push(filter);
            break;
          }
          case 'drawText': {
            // The text goes in a file rather than in the filtergraph. drawtext
            // escaping is two levels deep (filter argument, then graph) and
            // this is the only place user-typed text would reach an argv, so
            // `textfile=` removes the problem instead of managing it.
            const name = `text${auxFiles.length}.txt`;
            auxFiles.push({ name, content: op.text });
            const parts = [
              `drawtext=textfile=${name}`,
              `fontsize=${op.sizePx}`,
              `fontcolor=${op.color}`,
              TEXT_POSITION[op.position],
            ];
            if (options.fontFile) parts.splice(1, 0, `fontfile=${options.fontFile}`);
            if (op.boxColor) parts.push('box=1', `boxcolor=${op.boxColor}`, 'boxborderw=12');
            else parts.push('borderw=2', 'bordercolor=black');
            vf.push(parts.join(':'));
            break;
          }
          case 'subtitles':
            if (op.burnIn) {
              vf.push(`subtitles=${op.path}`);
            } else {
              extraInputs.push('-i', op.path);
            }
            break;
          case 'palette':
            complex = claimComplex(complex, 'palette');
            paletteColors = op.colors;
            paletteDither = op.dither;
            break;
        }
        break;

      case 'stream':
        switch (op.op) {
          case 'dropAudio':
            dropAudio = true;
            break;
          case 'dropVideo':
            dropVideo = true;
            break;
          case 'concat':
            complex = claimComplex(complex, 'concat');
            concatCount = op.count;
            concatReencode = op.reencode;
            break;
          case 'mixAudio':
            complex = claimComplex(complex, 'mix');
            mixSources = op.sources;
            mixDuckDb = op.duckOriginalDb;
            break;
        }
        break;

      case 'encode':
        switch (op.op) {
          case 'video':
            videoIntent = {
              codec: op.codec,
              ...(op.crf !== undefined ? { crf: op.crf } : {}),
              ...(op.bitrateKbps !== undefined ? { bitrateKbps: op.bitrateKbps } : {}),
              ...(op.maxrateKbps !== undefined ? { maxrateKbps: op.maxrateKbps } : {}),
              ...(op.preset !== undefined ? { preset: op.preset } : {}),
            };
            break;
          case 'audio':
            audioIntent = {
              codec: op.codec,
              ...(op.bitrateKbps !== undefined ? { bitrateKbps: op.bitrateKbps } : {}),
              ...(op.sampleRateHz !== undefined ? { sampleRateHz: op.sampleRateHz } : {}),
            };
            break;
          case 'image':
            imageFormat = op.format;
            imageQuality = op.quality ?? null;
            if (op.dpi !== undefined) dpi = op.dpi;
            break;
        }
        break;

      case 'container':
        switch (op.op) {
          case 'format':
            ext = op.ext;
            containerSet = true;
            faststart = op.faststart ?? false;
            break;
          case 'segment':
            segmentSeconds = op.seconds;
            break;
        }
        break;
    }
  }

  // Image tools have no container op — the format *is* the container.
  if (!containerSet && imageFormat) ext = imageFormat === 'jpeg' ? 'jpg' : imageFormat;

  // An audio-only container has no video stream to write, and neither does an
  // audio-only *source* — an .mp4 carrying nothing but a podcast is a real
  // thing people upload. Asking FFmpeg for `-c:v` in either case fails
  // outright, and it is not the tool's mistake.
  if (AUDIO_ONLY_CONTAINERS.has(ext) || primary.kind === 'audio' || primary.hasVideo === false) {
    dropVideo = true;
  }

  // The same trap on the other side, and a nastier one, because it fires on
  // ordinary files. A silent clip put through the speed tool gets `atempo` in
  // `-af`, and FFmpeg fails with "Stream specifier ':a' in filtergraph
  // description matches no streams" — a job that looks perfectly reasonable in
  // the UI and cannot run. Plenty of screen recordings have no audio track.
  if (VIDEO_ONLY_CONTAINERS.has(ext) || primary.hasAudio === false) {
    dropAudio = true;
  }

  /* ---- validation ------------------------------------------------------- */

  // A degenerate range is the worst failure mode in the pipeline: FFmpeg exits
  // 0 and writes a header-only file of a couple of hundred bytes, so the job is
  // marked done and the user downloads something that will not play.
  if (seekStart !== null || durationSec !== null) {
    const start = seekStart ?? 0;
    if (!Number.isFinite(start) || (durationSec !== null && !Number.isFinite(durationSec))) {
      throw new CompileError('range-invalid');
    }
    if (start < 0) throw new CompileError('range-invalid');
    if (durationSec !== null && durationSec <= 0.001) throw new CompileError('range-empty');
    if (primary.durationSec !== undefined && start >= primary.durationSec) {
      throw new CompileError('range-starts-after-end', {
        start,
        duration: primary.durationSec,
      });
    }
    // A range that runs off the end is not an error — FFmpeg simply stops at
    // EOF — but an honest `-t` keeps the progress percentage and the size
    // estimate from being nonsense for the whole job.
    if (durationSec !== null && primary.durationSec !== undefined) {
      durationSec = Math.min(durationSec, primary.durationSec - start);
    }
  }

  if (complex === 'concat' && inputs.length < concatCount) {
    throw new CompileError('multi-input-required', { needed: concatCount, given: inputs.length });
  }
  if (complex === 'mix' && inputs.length < mixSources) {
    throw new CompileError('multi-input-required', { needed: mixSources, given: inputs.length });
  }

  /* ---- resolve codecs ---------------------------------------------------- */
  //
  // This has to happen before any rate-control flag is emitted. Deciding the
  // encoder afterwards is how `-preset medium` ends up attached to libvpx-vp9,
  // which does not have that option and exits non-zero.

  const isImageJob = imageFormat !== null;
  const filtersPresent = vf.length > 0 || complex !== null;

  // Writing the same container we read is always copy-safe, whatever is inside
  // it. Without this, every `codec: 'copy'` tool re-encodes in the browser —
  // where there is no ffprobe and so no `videoCodec` to check against the
  // table — which would make muting a video as expensive as compressing one.
  const targetContainer = CONTAINER_ALIAS[ext] ?? ext;
  const sameContainer = containerOf(primary.fsName) === targetContainer;

  let effectiveVideo = 'copy';
  if (isImageJob && imageFormat) {
    effectiveVideo = IMAGE_ENCODER[imageFormat];
  } else if (!dropVideo) {
    const requested = videoIntent ? VIDEO_ENCODER[videoIntent.codec] : 'copy';
    const fallback = FALLBACK_VIDEO[ext] ?? 'libx264';
    effectiveVideo = requested;

    if (requested === 'copy' && (filtersPresent || (complex === 'concat' && concatReencode))) {
      // A filter and `-c:v copy` together is a hard FFmpeg error.
      effectiveVideo = fallback;
      notes.push({ code: 'filter-forces-reencode' });
    } else if (requested === 'copy') {
      if (!sameContainer && !copyIsLegal(CONTAINER_VIDEO[ext], primary.videoCodec)) {
        effectiveVideo = fallback;
        notes.push({
          code: 'container-forces-video-reencode',
          container: ext,
          ...(primary.videoCodec !== undefined ? { sourceCodec: primary.videoCodec } : {}),
        });
      }
    } else if (!copyIsLegal(CONTAINER_VIDEO[ext], ENCODER_PRODUCES[requested])) {
      effectiveVideo = fallback;
      notes.push({
        code: 'codec-not-valid-in-container',
        codec: requested,
        container: ext,
        using: fallback,
      });
    }
  }

  let effectiveAudio = 'copy';
  if (!dropAudio && !isImageJob) {
    const requested = audioIntent ? AUDIO_ENCODER[audioIntent.codec] : 'copy';
    const fallback = FALLBACK_AUDIO[ext] ?? 'aac';
    effectiveAudio = requested;

    if (requested === 'copy' && (af.length > 0 || complex === 'mix' || (complex === 'concat' && concatReencode))) {
      effectiveAudio = fallback;
    } else if (requested === 'copy') {
      if (!sameContainer && !copyIsLegal(CONTAINER_AUDIO[ext], primary.audioCodec)) {
        effectiveAudio = fallback;
        notes.push({
          code: 'container-forces-audio-reencode',
          container: ext,
          ...(primary.audioCodec !== undefined ? { sourceCodec: primary.audioCodec } : {}),
        });
      }
    } else if (!copyIsLegal(CONTAINER_AUDIO[ext], ENCODER_PRODUCES[requested])) {
      effectiveAudio = fallback;
      notes.push({
        code: 'codec-not-valid-in-container',
        codec: requested,
        container: ext,
        using: fallback,
      });
    }
  }

  const reencode = !dropVideo && effectiveVideo !== 'copy';

  // Now that we know the answer, say the true thing about the cut. Announcing
  // "lands on the nearest keyframe" before the encoder is resolved is how a
  // frame-accurate cut ends up carrying a warning about not being one.
  if (seekStart !== null && !reencode) {
    notes.push({ code: 'cut-is-keyframe-aligned' });
  }

  // H.264 and H.265 reject odd dimensions outright. A user typing 641 into a
  // width box, or a source that is 1279x721, must not produce a failed job.
  // This must key off the *effective* encoder, not off whether a filter
  // happens to exist — the container-swap path above arrives here with an
  // empty filter chain and a real encoder, which is exactly the failing case.
  if (!dropVideo && !isImageJob && NEEDS_EVEN_DIMENSIONS.has(effectiveVideo) && complex === null) {
    vf.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
    const odd = (primary.width !== undefined && primary.width % 2 === 1) ||
      (primary.height !== undefined && primary.height % 2 === 1);
    if (odd) notes.push({ code: 'dimensions-rounded-to-even' });
  }

  /* ---- emit -------------------------------------------------------------- */

  const args: string[] = ['-hide_banner', '-y'];

  // Seek placement is the highest-leverage performance decision here. Before
  // -i, FFmpeg uses the demuxer index: near-instant, and still frame-accurate
  // when re-encoding. After -i it decodes and discards every frame up to the
  // cut point, which on a 40-minute file is the difference between a fifth of
  // a second and several minutes.
  if (seekStart !== null) args.push('-ss', num(seekStart));
  args.push(...preInput);

  if (complex === 'concat' && !concatReencode) {
    // The concat demuxer needs a list file. We control every name in it.
    const list = inputs
      .slice(0, concatCount)
      .map((file) => `file '${file.fsName}'`)
      .join('\n');
    auxFiles.push({ name: 'concat.txt', content: `${list}\n` });
    args.push('-f', 'concat', '-safe', '0', '-i', 'concat.txt');
  } else if (complex === 'concat' || complex === 'mix') {
    const count = complex === 'concat' ? concatCount : mixSources;
    for (const file of inputs.slice(0, count)) args.push('-i', file.fsName);
  } else {
    args.push('-i', primary.fsName);
  }
  args.push(...extraInputs);

  if (durationSec !== null) {
    // -t rather than -to: after a pre-input -ss, some builds read -to relative
    // to the seek point and some do not. -t has never been ambiguous.
    args.push('-t', num(durationSec / speedFactor));
  }

  const chain = vf.join(',');

  switch (complex) {
    case 'palette': {
      const prefix = chain ? `${chain},` : '';
      const dither = paletteDither ? 'dither=bayer:bayer_scale=3' : 'dither=none';
      args.push(
        '-filter_complex',
        `[0:v]${prefix}split[a][b];` +
          `[a]palettegen=max_colors=${paletteColors}:stats_mode=diff[p];` +
          `[b][p]paletteuse=${dither}`,
      );
      break;
    }
    case 'flatten': {
      // JPEG cannot store transparency, so it has to be composited onto
      // something. FFmpeg's default is black; the user picked a colour.
      const suffix = chain ? `,${chain}` : '';
      args.push(
        '-filter_complex',
        `color=${flattenColor}[bg];[bg][0:v]scale2ref[bg][fg];` +
          `[bg][fg]overlay=shortest=1${suffix}`,
      );
      break;
    }
    case 'concat': {
      if (concatReencode) {
        const streams = Array.from({ length: concatCount }, (_, i) =>
          dropAudio ? `[${i}:v]` : `[${i}:v][${i}:a]`,
        ).join('');
        const audioFlag = dropAudio ? 0 : 1;
        const suffix = chain ? `;[v]${chain}[vout]` : '';
        args.push(
          '-filter_complex',
          `${streams}concat=n=${concatCount}:v=1:a=${audioFlag}[v]${dropAudio ? '' : '[a]'}${suffix}`,
        );
        args.push('-map', suffix ? '[vout]' : '[v]');
        if (!dropAudio) args.push('-map', '[a]');
      } else if (chain) {
        args.push('-vf', chain);
      }
      break;
    }
    case 'mix': {
      const duck = mixDuckDb !== undefined ? `[0:a]volume=${num(mixDuckDb)}dB[a0];` : '';
      const first = mixDuckDb !== undefined ? '[a0]' : '[0:a]';
      args.push(
        '-filter_complex',
        `${duck}${first}[1:a]amix=inputs=${mixSources}:duration=first:dropout_transition=0[aout]`,
      );
      args.push('-map', '0:v', '-map', '[aout]');
      if (chain) args.push('-vf', chain);
      break;
    }
    case null: {
      if (chain && !dropVideo) args.push('-vf', chain);
      if (af.length && !dropAudio) args.push('-af', af.join(','));
      break;
    }
  }

  if (complex !== null && af.length && !dropAudio && complex !== 'mix') {
    args.push('-af', af.join(','));
  }

  if (dropAudio) args.push('-an');
  if (dropVideo) args.push('-vn');

  /* ---- rate control, now that the encoder is known ----------------------- */

  const dropped: string[] = [];

  if (isImageJob && imageFormat) {
    args.push('-c:v', effectiveVideo, '-frames:v', '1');
    if (imageQuality !== null) {
      if (imageFormat === 'jpeg') args.push('-q:v', String(jpegQuality(imageQuality)));
      else if (imageFormat === 'webp') args.push('-quality', String(imageQuality));
      else if (imageFormat === 'avif') args.push('-crf', String(Math.round(63 - (imageQuality / 100) * 45)));
    }
    args.push('-an');
  } else {
    if (!dropVideo) {
      args.push('-c:v', effectiveVideo);
      if (videoIntent && effectiveVideo !== 'copy') {
        if (videoIntent.crf !== undefined) {
          if (ACCEPTS_CRF.has(effectiveVideo)) {
            args.push('-crf', String(videoIntent.crf));
            // VP9 ignores -crf entirely unless the target bitrate is 0.
            if (effectiveVideo === 'libvpx-vp9' && videoIntent.bitrateKbps === undefined) {
              args.push('-b:v', '0');
              notes.push({ code: 'vp9-crf-needs-zero-bitrate' });
            }
          } else {
            dropped.push('-crf');
          }
        }
        if (videoIntent.bitrateKbps !== undefined) {
          args.push('-b:v', `${videoIntent.bitrateKbps}k`);
        }
        if (videoIntent.maxrateKbps !== undefined) {
          args.push('-maxrate', `${videoIntent.maxrateKbps}k`);
          args.push('-bufsize', `${videoIntent.maxrateKbps * 2}k`);
        }
        if (videoIntent.preset !== undefined) {
          if (ACCEPTS_PRESET.has(effectiveVideo)) args.push('-preset', videoIntent.preset);
          else dropped.push('-preset');
        }
      }
    }

    if (!dropAudio) {
      args.push('-c:a', effectiveAudio);
      if (audioIntent && effectiveAudio !== 'copy') {
        if (audioIntent.bitrateKbps !== undefined && effectiveAudio !== 'flac') {
          args.push('-b:a', `${audioIntent.bitrateKbps}k`);
        }
        if (audioIntent.sampleRateHz !== undefined) {
          args.push('-ar', String(audioIntent.sampleRateHz));
        }
      }
    }
  }

  if (dropped.length) {
    notes.push({ code: 'encoder-options-dropped', options: dropped, encoder: effectiveVideo });
  }

  // Without this the moov atom sits at the end of the file and the result will
  // not start playing until it has fully downloaded.
  if (faststart && (ext === 'mp4' || ext === 'mov' || ext === 'm4a' || ext === 'm4v')) {
    args.push('-movflags', '+faststart');
  }

  if (ext === 'gif') args.push('-loop', '0');

  let outputName: string;
  if (segmentSeconds !== null) {
    args.push(
      '-f',
      'segment',
      '-segment_time',
      num(segmentSeconds),
      '-reset_timestamps',
      '1',
    );
    outputName = `${base}_%03d.${ext}`;
  } else {
    outputName = `${base}.${ext}`;
  }
  args.push(outputName);

  return {
    passes: [args],
    outputName,
    auxFiles,
    reencode,
    notes,
    needsFullBuffer,
    ...(dpi !== null ? { postProcess: { setDpi: dpi } } : {}),
  };
}
