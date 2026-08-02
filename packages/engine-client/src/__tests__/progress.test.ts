import { describe, expect, it } from 'vitest';
import { ProgressTracker, parseDuration, parseProgressTime } from '../progress';
import { parseProbeOutput } from '../probe';

const STATUS =
  'frame=  120 fps= 30 q=28.0 size=     512kB time=00:00:04.03 bitrate= 1040.2kbits/s speed=1.2x';

describe('parsing FFmpeg status lines', () => {
  it('reads the elapsed time', () => {
    expect(parseProgressTime(STATUS)).toBeCloseTo(4.03, 2);
  });

  it('reads hours', () => {
    expect(parseProgressTime('time=01:02:03.50')).toBeCloseTo(3723.5, 2);
  });

  it('reads the input duration header', () => {
    expect(parseDuration('  Duration: 00:00:06.02, start: 0.000000, bitrate: 1104 kb/s')).toBeCloseTo(
      6.02,
      2,
    );
  });

  it('ignores lines that say nothing about time', () => {
    expect(parseProgressTime('  Stream mapping:')).toBeNull();
  });
});

describe('ProgressTracker', () => {
  it('reports a fraction of the expected duration', () => {
    const tracker = new ProgressTracker(8);
    expect(tracker.push(STATUS)).toBeCloseTo(4.03 / 8, 3);
  });

  it('never goes backwards', () => {
    // FFmpeg re-reports earlier timestamps on a two-pass job and around
    // filter flushes. A bar that jumps backwards reads as a hang.
    const tracker = new ProgressTracker(10);
    tracker.push('time=00:00:08.00');
    expect(tracker.push('time=00:00:02.00')).toBeCloseTo(0.8, 3);
  });

  it('never exceeds 1, whatever FFmpeg claims', () => {
    const tracker = new ProgressTracker(2);
    expect(tracker.push('time=00:00:30.00')).toBe(1);
  });

  it('falls back to the Duration header when no duration was supplied', () => {
    const tracker = new ProgressTracker();
    expect(tracker.push(STATUS)).toBeNull();
    tracker.push('  Duration: 00:00:08.00, start: 0.000000, bitrate: 1104 kb/s');
    expect(tracker.push(STATUS)).toBeCloseTo(4.03 / 8, 3);
  });
});

describe('parsing the stream table', () => {
  const withAudio = [
    'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'input0.mp4\':',
    '  Duration: 00:00:06.00, start: 0.000000, bitrate: 1104 kb/s',
    '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 640x360 [SAR 1:1 DAR 16:9], 968 kb/s, 30 fps, 30 tbr, 15360 tbn',
    '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, mono, fltp, 128 kb/s',
  ];

  it('reads both streams, the codecs and the geometry', () => {
    const result = parseProbeOutput(withAudio);
    expect(result).toMatchObject({
      hasVideo: true,
      hasAudio: true,
      videoCodec: 'h264',
      audioCodec: 'aac',
      width: 640,
      height: 360,
      fps: 30,
    });
    expect(result.durationSec).toBeCloseTo(6, 2);
  });

  it('reports a silent file as silent', () => {
    // The whole reason this exists: Chromium will not tell us, and an audio
    // filter against a stream that is not there is a hard failure.
    const result = parseProbeOutput(withAudio.filter((l) => !l.includes('Audio:')));
    expect(result.hasAudio).toBe(false);
    expect(result.audioCodec).toBeUndefined();
    expect(result.hasVideo).toBe(true);
  });

  it('reports an audio-only file as having no video', () => {
    const result = parseProbeOutput([
      "Input #0, mp3, from 'input0.mp3':",
      '  Duration: 00:03:00.00, start: 0.000000, bitrate: 192 kb/s',
      '  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 192 kb/s',
    ]);
    expect(result.hasVideo).toBe(false);
    expect(result.hasAudio).toBe(true);
    expect(result.audioCodec).toBe('mp3');
  });

  it('says nothing rather than guessing when the output is empty', () => {
    expect(parseProbeOutput([])).toEqual({ hasVideo: false, hasAudio: false });
  });
});
