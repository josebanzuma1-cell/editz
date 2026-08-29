/**
 * Progress, parsed from FFmpeg's stderr.
 *
 * ffmpeg.wasm emits its own `progress` events, but they are derived from a
 * duration it guesses at load time and go wrong — over 100%, or stuck at zero —
 * on exactly the inputs users bring: variable frame rate phone video, files
 * with no duration in the header, anything trimmed.
 *
 * So we read the `time=` field out of the log line instead, which is the same
 * thing the native worker will parse in M3. One parser, one progress shape,
 * both runners — the UI never learns which engine produced a number.
 */

/** `frame= 120 fps=30 q=28.0 size=  512kB time=00:00:04.03 bitrate=...` */
const TIME = /time=\s*(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/;
const DURATION = /Duration:\s*(\d+):(\d{2}):(\d{2})(?:\.(\d+))?/;

export function parseTimestamp(line: string, pattern: RegExp): number | null {
  const match = pattern.exec(line);
  if (!match) return null;
  const [, h, m, s, fraction] = match;
  const seconds =
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${fraction ?? '0'}`);
  return Number.isFinite(seconds) ? seconds : null;
}

export const parseProgressTime = (line: string): number | null => parseTimestamp(line, TIME);
export const parseDuration = (line: string): number | null => parseTimestamp(line, DURATION);

/**
 * Turns log lines into a 0–1 fraction.
 *
 * Deliberately monotonic and clamped. A progress bar that goes backwards, or
 * sits at 100% for thirty seconds, reads as a hang — and on a slow device a
 * genuine hang is the thing users are already worried about.
 */
export class ProgressTracker {
  private highest = 0;
  private duration: number | null;

  constructor(expectedDurationSec?: number) {
    this.duration = expectedDurationSec && expectedDurationSec > 0 ? expectedDurationSec : null;
  }

  /** Returns the new fraction, or null when the line said nothing about time. */
  push(line: string): number | null {
    if (this.duration === null) {
      // Fall back to the Duration: header FFmpeg prints for the input.
      const found = parseDuration(line);
      if (found !== null && found > 0) this.duration = found;
    }

    const time = parseProgressTime(line);
    if (time === null || this.duration === null) return null;

    const fraction = Math.min(1, Math.max(0, time / this.duration));
    if (fraction <= this.highest) return this.highest;
    this.highest = fraction;
    return fraction;
  }

  complete(): number {
    this.highest = 1;
    return 1;
  }
}
