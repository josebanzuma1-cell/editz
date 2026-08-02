import { kindFromMime, type MediaInput } from '@editz/engine-core';

/**
 * Reads what the browser can tell us about a file without decoding it.
 *
 * This is not processing. No bytes are transformed and nothing is uploaded —
 * the file is handed to a media element as an object URL, the element reports
 * its metadata, and the URL is revoked. It gives us duration and pixel
 * dimensions, which is enough for `estimateOutput` and for the data meter to
 * be honest before the user commits to anything.
 *
 * Codec and bitrate are not available here. That is why every probe field on
 * `MediaInput` is optional.
 */
export async function probe(file: File): Promise<MediaInput> {
  const kind = kindFromMime(file.type) ?? 'video';

  const base: MediaInput = {
    name: file.name,
    bytes: file.size,
    mime: file.type,
    kind,
  };

  try {
    if (kind === 'image') return { ...base, ...(await probeImage(file)) };
    return { ...base, ...(await probeMedia(file, kind)) };
  } catch {
    // A file we cannot probe is still a file we can process. The meter falls
    // back to "we cannot estimate that" rather than the page falling over.
    return base;
  }
}

function probeImage(file: File): Promise<Partial<MediaInput>> {
  return withObjectUrl(file, (url) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('could not decode image'));
      img.src = url;
    }),
  );
}

function probeMedia(file: File, kind: 'video' | 'audio'): Promise<Partial<MediaInput>> {
  return withObjectUrl(file, (url) =>
    new Promise((resolve, reject) => {
      const el = document.createElement(kind);
      el.preload = 'metadata';

      el.onloadedmetadata = () => {
        const duration = Number.isFinite(el.duration) ? el.duration : undefined;
        if (kind === 'video' && el instanceof HTMLVideoElement) {
          const audio = detectAudio(el);
          resolve({
            ...(duration !== undefined ? { durationSec: duration } : {}),
            width: el.videoWidth,
            height: el.videoHeight,
            ...(audio !== undefined ? { hasAudio: audio } : {}),
            hasVideo: el.videoWidth > 0,
          });
        } else {
          resolve({
            ...(duration !== undefined ? { durationSec: duration } : {}),
            hasAudio: true,
          });
        }
      };
      el.onerror = () => reject(new Error('could not read metadata'));
      el.src = url;
    }),
  );
}

/**
 * Best-effort "does this file have a sound track".
 *
 * Worth the trouble because the answer changes the command: an audio filter
 * against a file with no audio stream is a hard FFmpeg failure, and plenty of
 * screen recordings and phone clips are silent. There is no standard API for
 * it, so this reads the three vendor properties that exist and returns
 * `undefined` — meaning "nobody knows" — rather than guessing when none apply.
 */
function detectAudio(el: HTMLVideoElement): boolean | undefined {
  const probe = el as HTMLVideoElement & {
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length: number };
  };

  if (typeof probe.mozHasAudio === 'boolean') return probe.mozHasAudio;
  if (probe.audioTracks !== undefined) return probe.audioTracks.length > 0;
  // Chromium only counts bytes once decoding has started, so zero here means
  // "not yet", not "silent". Only a positive count tells us anything.
  if ((probe.webkitAudioDecodedByteCount ?? 0) > 0) return true;
  return undefined;
}

async function withObjectUrl<T>(file: File, fn: (url: string) => Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file);
  try {
    return await fn(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
