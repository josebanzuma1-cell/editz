import type { MediaInput } from '@editz/engine-core';
import type { ClientRunner } from './runner';
import { parseDuration } from './progress';

/**
 * Reads a file's real stream layout, in the browser.
 *
 * The DOM can tell us duration and pixel dimensions from a `<video>` element,
 * and that is enough for the meter — it is free and instant. What it cannot
 * tell us is what is actually inside the container: which codecs, and whether
 * there is an audio track at all. Firefox exposes `mozHasAudio` and Safari
 * exposes `audioTracks`; Chromium, which is most users, exposes neither.
 *
 * That gap has teeth. Without a codec the compiler must refuse every
 * cross-container stream copy, because guessing that `video/mp4` means H.264
 * is right most of the time and produces an unplayable file the rest. And
 * without `hasAudio` an audio filter on a silent clip becomes a hard FFmpeg
 * failure on a job that looked perfectly reasonable.
 *
 * So: ask FFmpeg. Running it with an input and no output makes it print the
 * stream table and exit — no decoding, no encoding, effectively instant. The
 * cost is that the core must already be loaded, which is why this runs at the
 * moment the user commits rather than when they choose a file.
 */

const VIDEO_STREAM = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video: (\w+)/;
const AUDIO_STREAM = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio: (\w+)/;
const DIMENSIONS = /,\s(\d{2,5})x(\d{2,5})[\s,]/;
const FPS = /,\s([\d.]+)\sfps/;

export interface ProbeResult {
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasVideo: boolean;
  hasAudio: boolean;
}

export function parseProbeOutput(lines: readonly string[]): ProbeResult {
  const result: ProbeResult = { hasVideo: false, hasAudio: false };

  for (const line of lines) {
    if (result.durationSec === undefined) {
      const duration = parseDuration(line);
      if (duration !== null) result.durationSec = duration;
    }

    const video = VIDEO_STREAM.exec(line);
    if (video?.[1]) {
      result.hasVideo = true;
      result.videoCodec = video[1].toLowerCase();

      const size = DIMENSIONS.exec(line);
      if (size?.[1] && size[2]) {
        result.width = Number(size[1]);
        result.height = Number(size[2]);
      }
      const fps = FPS.exec(line);
      if (fps?.[1]) result.fps = Number(fps[1]);
    }

    const audio = AUDIO_STREAM.exec(line);
    if (audio?.[1]) {
      result.hasAudio = true;
      result.audioCodec = audio[1].toLowerCase();
    }
  }

  return result;
}

/**
 * Merges a probe into what the DOM already told us.
 *
 * FFmpeg wins on anything it reports, because it is reading the container
 * rather than asking a media element to guess.
 */
export function mergeProbe(base: MediaInput, probed: ProbeResult): MediaInput {
  return {
    ...base,
    ...(probed.durationSec !== undefined ? { durationSec: probed.durationSec } : {}),
    ...(probed.width !== undefined ? { width: probed.width } : {}),
    ...(probed.height !== undefined ? { height: probed.height } : {}),
    ...(probed.fps !== undefined ? { fps: probed.fps } : {}),
    ...(probed.videoCodec !== undefined ? { videoCodec: probed.videoCodec } : {}),
    ...(probed.audioCodec !== undefined ? { audioCodec: probed.audioCodec } : {}),
    hasVideo: probed.hasVideo,
    hasAudio: probed.hasAudio,
  };
}

/**
 * Runs the null-output probe. Never throws for a normal file — FFmpeg exits
 * non-zero because no output was given, which is expected and not an error.
 */
export async function probeWithFfmpeg(
  runner: ClientRunner,
  file: File,
  fsName: string,
): Promise<ProbeResult> {
  const lines: string[] = [];
  try {
    await runner.run(
      { passes: [['-hide_banner', '-i', fsName]], outputName: fsName, auxFiles: [],
        reencode: false, notes: [], needsFullBuffer: false },
      { files: [file], fsNames: [fsName], onLog: (line) => lines.push(line) },
    );
  } catch {
    // Expected: "At least one output file must be specified".
  }
  return parseProbeOutput(lines);
}
