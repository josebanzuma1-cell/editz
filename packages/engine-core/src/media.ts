export type MediaKind = 'video' | 'audio' | 'image';

/**
 * What we know about a file *before* any work happens.
 *
 * The probe fields are all optional on purpose. On the client we read them from
 * a `<video>` / `<audio>` / `<img>` element, which gives duration and pixel
 * dimensions but never codec or bitrate. On the server ffprobe fills in
 * everything. `buildOps()` runs on both sides, so it must degrade gracefully
 * when a field is missing rather than assuming a probe has happened.
 */
export interface MediaInput {
  name: string;
  bytes: number;
  /** The browser-reported MIME type. Never trusted server-side — see §11. */
  mime: string;
  kind: MediaKind;

  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoBitrateKbps?: number;
  audioBitrateKbps?: number;
  hasAudio?: boolean;
  /**
   * Whether the file actually carries a video stream.
   *
   * Not the same question as `kind`. An `.mp4` with only an audio track is a
   * real thing people upload, and asking FFmpeg to write `-c:v` for it fails
   * outright. `undefined` means nobody has looked.
   */
  hasVideo?: boolean;

  /**
   * Source codec names as ffprobe reports them ('h264', 'aac', 'vp9').
   *
   * Only ever populated on the server. The browser cannot tell you what codec
   * is inside a file without decoding it, which is the whole job. The compiler
   * treats "unknown" as "cannot stream-copy" — guessing that `video/mp4` means
   * H.264 is right most of the time, and the times it is wrong produce a file
   * that does not play.
   */
  videoCodec?: string;
  audioCodec?: string;
}

/** Tools that take many files (merge, slideshow) get the whole list. */
export type MediaInputs = readonly MediaInput[];

export const KIND_BY_MIME_PREFIX: Record<string, MediaKind> = {
  video: 'video',
  audio: 'audio',
  image: 'image',
};

export function kindFromMime(mime: string): MediaKind | null {
  const prefix = mime.split('/')[0];
  if (!prefix) return null;
  return KIND_BY_MIME_PREFIX[prefix] ?? null;
}
