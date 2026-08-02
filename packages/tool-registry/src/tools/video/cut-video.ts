import { z } from 'zod';
import type { MediaInput, Operation } from '@editz/engine-core';
import { defineTool } from '../../types';

const params = z
  .object({
    startSec: z.number().min(0),
    endSec: z.number().min(0),
    /** Keyframe-accurate re-encode vs. instant stream copy. */
    accuracy: z.enum(['exact', 'fast']),
    keepAudio: z.boolean(),
  })
  .refine((p) => p.endSec > p.startSec, {
    message: 'The end has to come after the start',
    path: ['endSec'],
  });

type P = z.infer<typeof params>;

export const cutVideo = defineTool({
  slug: 'cut-video',
  name: 'Cut video',
  kind: 'video',
  category: 'edit',
  icon: 'scissors',
  accepts: ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/x-msvideo'],
  multiFile: false,

  execution: 'auto',
  requiresServer: (input, p) => {
    // Fast mode is a stream copy: no decoding, so file size barely matters and
    // we can happily do a 2GB file in the browser.
    if (p.accuracy === 'fast') return null;
    if (input.bytes > 400 * 1024 * 1024) return 'params-need-server';
    return null;
  },

  params,
  defaults: { startSec: 0, endSec: 10, accuracy: 'exact', keepAudio: true },

  ui: {
    controls: [
      { key: 'startSec', kind: 'time', label: 'Start', hintFromDuration: true },
      { key: 'endSec', kind: 'time', label: 'End', hintFromDuration: true },
      {
        key: 'accuracy',
        kind: 'segmented',
        label: 'Cut',
        options: [
          { value: 'exact', label: 'Exactly here', hint: 'Re-encodes, frame accurate' },
          { value: 'fast', label: 'Nearest keyframe', hint: 'Instant, no quality loss' },
        ],
      },
      { key: 'keepAudio', kind: 'toggle', label: 'Keep audio' },
    ],
  },

  buildOps: (_input: MediaInput, p: P): Operation[] => {
    const ops: Operation[] = [
      { stage: 'input', op: 'seek', startSec: p.startSec },
      { stage: 'input', op: 'duration', seconds: p.endSec - p.startSec },
    ];

    if (p.accuracy === 'fast') {
      // Stream copy. Instant, lossless, and lands on the nearest keyframe
      // before the requested point — which is the trade the user just chose.
      ops.push({ stage: 'encode', op: 'video', codec: 'copy' });
      ops.push(
        p.keepAudio
          ? { stage: 'encode', op: 'audio', codec: 'copy' }
          : { stage: 'stream', op: 'dropAudio' },
      );
    } else {
      ops.push({ stage: 'encode', op: 'video', codec: 'h264', crf: 20, preset: 'veryfast' });
      ops.push(
        p.keepAudio
          ? { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 160 }
          : { stage: 'stream', op: 'dropAudio' },
      );
    }

    ops.push({ stage: 'container', op: 'format', ext: 'mp4', faststart: true });
    return ops;
  },

  estimateOutput: (input: MediaInput, p: P) => {
    if (!input.durationSec) return null;
    const share = Math.min(1, (p.endSec - p.startSec) / input.durationSec);
    // A re-encode at CRF 20 usually lands a little under the source bitrate.
    const factor = p.accuracy === 'fast' ? 1 : 0.85;
    return Math.round(input.bytes * share * factor);
  },

  outputExtension: () => 'mp4',
  copyStatus: 'final',

  seo: {
    title: 'Cut video online — trim clips in your browser | Editz',
    h1: 'Cut video',
    description:
      'Trim the start and end off a video without uploading it. Works on MP4, MOV and MKV, free, and nothing leaves your device.',
    intro: [
      'Most videos need the first few seconds and the last few seconds taken off — the bit where you were still setting up, and the bit where you were reaching for the button. Cutting a video means picking a start point and an end point and keeping only what is between them. Editz does it in your browser, so the file is never uploaded and the trim costs you no data at all.',
      'There are two ways to cut, and the difference matters more than it sounds. Nearest keyframe is a stream copy: the video data is not decoded or re-encoded at all, just sliced and re-wrapped. It finishes almost instantly, works on very large files, and loses absolutely no quality — but it can only cut at a keyframe, which in practice means your start point may land up to a couple of seconds earlier than you asked. Exactly here re-encodes the section so the cut falls on the precise frame you chose. That takes real processing time and a small amount of quality, and it is the right choice when you are cutting to a beat or to a word.',
      'If you need to remove a section from the middle rather than the ends, split the video and merge the parts you are keeping.',
    ].join('\n\n'),
    steps: [
      'Choose your video. It is read straight from your device — nothing is uploaded.',
      'Set the start and end times, and pick whether the cut should be frame accurate or instant.',
      'Press Cut video and the trimmed clip downloads.',
    ],
    faq: [
      {
        q: 'Does trimming reduce the quality?',
        a: 'Not if you choose nearest keyframe — that mode copies the video data untouched, so the trimmed clip is bit for bit as good as the original. Exactly here re-encodes and loses a small amount, which is normally invisible but is the price of landing on the exact frame.',
      },
      {
        q: 'Why did my cut start earlier than I asked?',
        a: 'You used nearest keyframe. Video is only decodable from keyframes, which occur every couple of seconds, so an instant cut has to start at one. Switch to exactly here if the precise frame matters.',
      },
      {
        q: 'Can I cut a section out of the middle?',
        a: 'Not in one pass with this tool. Use split video to break the file at both points, then merge video to join the parts you want to keep. Both run in your browser too.',
      },
      {
        q: 'Is my video uploaded?',
        a: 'No, for almost every file. The trim happens in your browser and the meter on the page shows zero megabytes uploaded. Only very large files on low-memory devices fall back to our servers, and you are told before that happens.',
      },
      {
        q: 'What formats can I trim?',
        a: 'MP4, MOV, MKV, WebM and AVI. The result is always MP4, which plays everywhere and streams properly because the index is written at the front of the file.',
      },
    ],
    related: ['split-video', 'merge-video', 'compress-video', 'cut-audio'],
    keywords: [
      'cut video online',
      'trim video online free',
      'trim mp4',
      'cut video without uploading',
      'video trimmer',
    ],
  },
});
