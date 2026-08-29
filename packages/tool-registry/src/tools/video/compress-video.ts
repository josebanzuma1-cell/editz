import { z } from 'zod';
import type { MediaInput, Operation } from '@editz/engine-core';
import { defineTool } from '../../types';

const params = z
  .object({
    mode: z.enum(['quality', 'size']),
    quality: z.enum(['high', 'balanced', 'small']),
    targetSizeMb: z.number().int().min(1).max(2048).optional(),
    resolution: z.enum(['original', '1080p', '720p', '480p', '360p']),
    codec: z.enum(['h264', 'h265']),
    keepAudio: z.boolean(),
  })
  .refine((p) => p.mode !== 'size' || p.targetSizeMb != null, {
    message: 'Choose a target size',
    path: ['targetSizeMb'],
  });

type P = z.infer<typeof params>;

const CRF: Record<P['quality'], Record<P['codec'], number>> = {
  high: { h264: 22, h265: 26 },
  balanced: { h264: 27, h265: 31 },
  small: { h264: 32, h265: 36 },
};

const HEIGHT: Record<Exclude<P['resolution'], 'original'>, number> = {
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
  '360p': 360,
};

const AUDIO_KBPS = 128;
/** Muxing overhead, so a 25MB target does not come back at 25.4MB. */
const CONTAINER_HEADROOM = 0.97;

export const compressVideo = defineTool({
  slug: 'compress-video',
  name: 'Compress video',
  kind: 'video',
  category: 'edit',
  icon: 'minimize-2',
  accepts: ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/x-msvideo'],
  multiFile: false,

  execution: 'auto',
  requiresServer: (input, p) => {
    // Two-pass rate control on a long file blows both the wasm heap and the
    // user's patience. Single-pass CRF stays local at any length.
    if (p.mode === 'size' && (input.durationSec ?? 0) > 600) return 'params-need-server';
    // H.265 in wasm runs roughly 4x slower than H.264 on the same input.
    if (p.codec === 'h265' && input.bytes > 60 * 1024 * 1024) return 'params-need-server';
    return null;
  },

  params,
  defaults: {
    mode: 'quality',
    quality: 'balanced',
    resolution: 'original',
    codec: 'h264',
    keepAudio: true,
  },

  ui: {
    controls: [
      {
        key: 'mode',
        kind: 'segmented',
        label: 'Compress by',
        options: [
          { value: 'quality', label: 'Quality', hint: 'Consistent look, size varies' },
          { value: 'size', label: 'File size', hint: 'Hits a number you pick' },
        ],
      },
      {
        key: 'quality',
        kind: 'segmented',
        label: 'Quality',
        showIf: (p) => p.mode === 'quality',
        options: [
          { value: 'high', label: 'High', hint: 'Close to the original' },
          { value: 'balanced', label: 'Balanced', hint: 'About a third of the size' },
          { value: 'small', label: 'Small', hint: 'Visibly softer, much smaller' },
        ],
      },
      {
        key: 'targetSizeMb',
        kind: 'number',
        label: 'Target size',
        unit: 'MB',
        min: 1,
        max: 2048,
        step: 1,
        hint: 'WhatsApp accepts 25 MB',
        showIf: (p) => p.mode === 'size',
      },
      {
        key: 'resolution',
        kind: 'select',
        label: 'Resolution',
        hint: 'Dropping to 720p is usually the biggest single saving',
        options: [
          { value: 'original', label: 'Keep original' },
          { value: '1080p', label: '1080p' },
          { value: '720p', label: '720p' },
          { value: '480p', label: '480p' },
          { value: '360p', label: '360p' },
        ],
      },
      {
        key: 'codec',
        kind: 'segmented',
        label: 'Codec',
        options: [
          { value: 'h264', label: 'H.264', hint: 'Plays everywhere' },
          { value: 'h265', label: 'H.265', hint: 'About a third smaller, fussier playback' },
        ],
      },
      { key: 'keepAudio', kind: 'toggle', label: 'Keep audio' },
    ],
  },

  buildOps: (input: MediaInput, p: P): Operation[] => {
    const ops: Operation[] = [];

    if (p.resolution !== 'original') {
      const target = HEIGHT[p.resolution];
      // Only ever downscale. Upscaling a phone video to 1080p makes the file
      // bigger and the picture no better.
      if (!input.height || input.height > target) {
        ops.push({ stage: 'filter', op: 'scale', width: -2, height: target, flags: 'lanczos' });
      }
    }

    if (p.mode === 'size' && p.targetSizeMb != null && input.durationSec) {
      const audioKbps = p.keepAudio ? AUDIO_KBPS : 0;
      const totalKbits = p.targetSizeMb * 8 * 1024 * CONTAINER_HEADROOM;
      const videoKbps = Math.max(120, Math.floor(totalKbits / input.durationSec) - audioKbps);
      ops.push({
        stage: 'encode',
        op: 'video',
        codec: p.codec,
        bitrateKbps: videoKbps,
        maxrateKbps: Math.floor(videoKbps * 1.5),
        preset: 'medium',
      });
    } else {
      ops.push({
        stage: 'encode',
        op: 'video',
        codec: p.codec,
        crf: CRF[p.quality][p.codec],
        preset: 'medium',
      });
    }

    ops.push(
      p.keepAudio
        ? { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: AUDIO_KBPS }
        : { stage: 'stream', op: 'dropAudio' },
    );

    ops.push({ stage: 'container', op: 'format', ext: 'mp4', faststart: true });
    return ops;
  },

  estimateOutput: (input: MediaInput, p: P) => {
    if (p.mode === 'size' && p.targetSizeMb != null) return p.targetSizeMb * 1024 * 1024;
    if (!input.durationSec) return null;
    const base = { high: 0.62, balanced: 0.38, small: 0.18 }[p.quality];
    const scale =
      p.resolution === 'original' || !input.height
        ? 1
        : Math.min(1, (HEIGHT[p.resolution] / input.height) ** 1.6);
    const codec = p.codec === 'h265' ? 0.68 : 1;
    const audio = p.keepAudio ? 1 : 0.92;
    return Math.round(input.bytes * base * scale * codec * audio);
  },

  outputExtension: () => 'mp4',
  copyStatus: 'final',

  seo: {
    title: 'Compress video online — free, no upload | Editz',
    h1: 'Compress video',
    description:
      'Shrink MP4, MOV and MKV files in your browser. Nothing is uploaded, no account needed, and your video never leaves your device.',
    intro: [
      'A video file is large because it stores many still images per second, and most of that data is repetition a codec can throw away. Compressing re-encodes the file at a lower bitrate, so it takes up less space and less of your data bundle when you send it. Editz does this on your own device: your video is read into memory in the browser, re-encoded there, and handed straight back. It is never uploaded, so it costs you nothing in bandwidth and takes as long as your phone or laptop needs — not as long as your connection needs.',
      'There are two ways to compress. Quality mode picks a constant quality level and lets the file land where it lands; it looks the same every time, which is what you want for footage you are keeping. Size mode works backwards from a number — 25 MB for WhatsApp, 8 MB for an email attachment — and calculates the bitrate needed to hit it. Dropping the resolution to 720p is usually the single biggest saving, because a phone that recorded in 4K is carrying detail nobody watching on a phone will ever see. Choosing H.265 saves roughly another third over H.264, at the cost of some older devices refusing to play it.',
      'Compression is lossy. You cannot recover the detail afterwards, so keep your original.',
    ].join('\n\n'),
    steps: [
      'Drop your video in, or tap to pick one. It stays on your device — the meter shows 0 MB uploaded.',
      'Choose a quality level, or switch to file size and type the size you need. The estimate updates as you change options.',
      'Press Compress video. The result downloads when it finishes, and nothing is left behind.',
    ],
    faq: [
      {
        q: 'Is my video uploaded anywhere?',
        a: 'Not for most files. Compression runs in your browser, and the meter on the page shows exactly how much has been uploaded — normally zero. Very large files, and older phones with little memory, fall back to our servers, and we tell you that before you start along with the number of megabytes it will cost you.',
      },
      {
        q: 'How much quality will I lose?',
        a: 'At the balanced setting most people cannot tell the difference at normal viewing size, and the file is usually about a third of the original. Small trades visible softness for a much smaller file. High stays close to the original and still saves space. Compression is one-way, so keep the original if it matters.',
      },
      {
        q: 'How do I get a video under 25 MB for WhatsApp?',
        a: 'Switch to file size and enter 25. Editz works out the bitrate from the length of your video and targets that size. If the result looks poor, the video is simply too long for 25 MB at a watchable bitrate — drop it to 720p or 480p as well, or trim it first.',
      },
      {
        q: 'Which formats can I compress?',
        a: 'MP4, MOV, MKV, WebM and AVI go in. Everything comes out as MP4 with the metadata moved to the front, so it starts playing before it has finished downloading. If you need a different container, run the result through the video converter.',
      },
      {
        q: 'Why is it slower than an upload site?',
        a: 'Because the work is happening on your device rather than on a server farm. On a mid-range phone expect roughly real time — a two-minute clip takes about two minutes. What you get for the wait is that your video never leaves your hands and the whole thing costs you no data.',
      },
      {
        q: 'Is there a file size limit?',
        a: 'Free and anonymous use goes up to 500 MB per file. Pro goes to 4 GB. Anything that is processed on our servers is deleted automatically within 24 hours, and you can delete it immediately from the download screen.',
      },
    ],
    related: ['resize-video', 'video-converter', 'cut-video', 'compress-image'],
    keywords: [
      'compress video online',
      'compress video free',
      'reduce video file size',
      'compress video for whatsapp',
      'make video smaller online',
      'compress mp4',
    ],
  },
});
