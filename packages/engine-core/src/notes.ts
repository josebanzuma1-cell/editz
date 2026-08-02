/**
 * What the compiler tells the user, as codes rather than sentences.
 *
 * engine-core is shared with the Node worker and with a UI that ships in
 * English and Swahili and is meant to make Luganda trivial (§11). A finished
 * English string in here means the Swahili tool page shows English warnings
 * under a Swahili meter, and adding a language means editing the FFmpeg
 * compiler. So the compiler emits codes and structured detail; the UI resolves
 * them.
 *
 * Codes are also the only sensible thing to log and aggregate — "how often does
 * a container swap force a re-encode" is a question about `container-forces-
 * video-reencode`, not about a sentence.
 */

export type CompileNote =
  /** Stream-copy cut: lands on the nearest preceding keyframe, not the exact frame. */
  | { code: 'cut-is-keyframe-aligned' }
  /** The chosen container cannot carry the source video track as-is. */
  | { code: 'container-forces-video-reencode'; container: string; sourceCodec?: string }
  /** As above, for audio. */
  | { code: 'container-forces-audio-reencode'; container: string; sourceCodec?: string }
  /** A tool asked for a codec the container cannot hold; we substituted. */
  | { code: 'codec-not-valid-in-container'; codec: string; container: string; using: string }
  /** A filter is present, so a stream copy was not possible. */
  | { code: 'filter-forces-reencode' }
  /** Odd width or height snapped down to even for H.264/H.265. */
  | { code: 'dimensions-rounded-to-even' }
  /** The crop box ran off the edge of the frame and was pulled back in. */
  | { code: 'crop-clamped-to-frame' }
  /** The whole file has to be held in memory at once. */
  | { code: 'buffers-whole-file' }
  /** Rate-control flags were dropped because the encoder changed under them. */
  | { code: 'encoder-options-dropped'; options: string[]; encoder: string }
  /** VP9 needs -b:v 0 for CRF to mean anything; we added it. */
  | { code: 'vp9-crf-needs-zero-bitrate' };

export type CompileNoteCode = CompileNote['code'];

export type CompileErrorCode =
  | 'range-invalid'
  | 'range-empty'
  | 'range-starts-after-end'
  | 'scale-needs-a-dimension'
  | 'multi-input-required'
  | 'single-input-expected'
  | 'unsupported-operation';

/**
 * Thrown for input the compiler will not turn into a command.
 *
 * The degenerate-trim case is the one that earns this class. FFmpeg given an
 * empty range exits 0 and writes a ~260-byte header-only file, so the job is
 * marked done and the user downloads something that will not play. A thrown
 * error is far better than a successful lie.
 */
export class CompileError extends Error {
  readonly code: CompileErrorCode;
  readonly detail: Record<string, string | number> | undefined;

  constructor(code: CompileErrorCode, detail?: Record<string, string | number>) {
    // The message is for logs and stack traces only. Never render it — resolve
    // `code` through the UI's messages instead.
    super(`compile: ${code}`);
    this.name = 'CompileError';
    this.code = code;
    this.detail = detail;
  }
}
