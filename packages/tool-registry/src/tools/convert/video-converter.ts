import { z } from 'zod';
import type { AudioCodec, MediaInput, Operation, VideoCodec } from '@editz/engine-core';
import { defineTool } from '../../types';

const params = z.object({
  format: z.enum(['mp4', 'webm', 'mkv', 'mov', 'avi']),
  quality: z.enum(['high', 'balanced', 'small']),
  keepAudio: z.boolean(),
});

type P = z.infer<typeof params>;
type Format = P['format'];

/** What each container is normally expected to hold. Putting VP9 in an MP4 is
 *  legal and almost nothing plays it, so the container picks the codec. */
const CODECS: Record<Format, { video: VideoCodec; audio: AudioCodec }> = {
  mp4: { video: 'h264', audio: 'aac' },
  mov: { video: 'h264', audio: 'aac' },
  mkv: { video: 'h264', audio: 'aac' },
  avi: { video: 'h264', audio: 'mp3' },
  webm: { video: 'vp9', audio: 'opus' },
};

const CRF: Record<P['quality'], Record<'h264' | 'vp9', number>> = {
  high: { h264: 20, vp9: 28 },
  balanced: { h264: 24, vp9: 33 },
  small: { h264: 30, vp9: 38 },
};

const AUDIO_KBPS: Record<P['quality'], number> = { high: 192, balanced: 128, small: 96 };

export const videoConverter = defineTool({
  slug: 'video-converter',
  name: 'Convert video',
  kind: 'video',
  category: 'convert',
  icon: 'repeat',
  accepts: [
    'video/mp4',
    'video/quicktime',
    'video/x-matroska',
    'video/webm',
    'video/x-msvideo',
    'video/mpeg',
    'video/3gpp',
    'video/x-flv',
  ],
  multiFile: false,

  execution: 'auto',
  requiresServer: (_input, p) => {
    // WebM always goes to the server, at any size.
    //
    // Not a performance judgement: libvpx-vp9 in @ffmpeg/core-mt 0.12.10
    // crashes partway through the encode — reproducibly, on a three-second
    // 320x240 clip, at the same frame every time. Every other container in
    // this tool completes in the browser. Until the core is fixed or replaced,
    // offering WebM locally means offering a button that does not work, and
    // the meter tells the user the upload cost before they commit.
    if (p.format === 'webm') return 'params-need-server';
    return null;
  },

  params,
  defaults: { format: 'mp4', quality: 'balanced', keepAudio: true },

  ui: {
    controls: [
      {
        key: 'format',
        kind: 'segmented',
        label: 'Convert to',
        options: [
          { value: 'mp4', label: 'MP4', hint: 'Plays on everything' },
          { value: 'webm', label: 'WebM', hint: 'Smaller, for the web' },
          { value: 'mkv', label: 'MKV', hint: 'Flexible container' },
          { value: 'mov', label: 'MOV', hint: 'Apple editing tools' },
          { value: 'avi', label: 'AVI', hint: 'Older software' },
        ],
      },
      {
        key: 'quality',
        kind: 'segmented',
        label: 'Quality',
        options: [
          { value: 'high', label: 'High' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'small', label: 'Small' },
        ],
      },
      { key: 'keepAudio', kind: 'toggle', label: 'Keep audio' },
    ],
  },

  buildOps: (_input: MediaInput, p: P): Operation[] => {
    const codecs = CODECS[p.format];
    const crfKey = codecs.video === 'vp9' ? 'vp9' : 'h264';

    const ops: Operation[] = [
      {
        stage: 'encode',
        op: 'video',
        codec: codecs.video,
        crf: CRF[p.quality][crfKey],
        preset: 'medium',
      },
    ];

    ops.push(
      p.keepAudio
        ? { stage: 'encode', op: 'audio', codec: codecs.audio, bitrateKbps: AUDIO_KBPS[p.quality] }
        : { stage: 'stream', op: 'dropAudio' },
    );

    ops.push({
      stage: 'container',
      op: 'format',
      ext: p.format,
      // Only MP4-family containers have a moov atom to move.
      faststart: p.format === 'mp4' || p.format === 'mov',
    });
    return ops;
  },

  estimateOutput: (input: MediaInput, p: P) => {
    const byQuality = { high: 0.85, balanced: 0.55, small: 0.3 }[p.quality];
    // VP9 buys roughly 30% over H.264 at matched quality.
    const byCodec = CODECS[p.format].video === 'vp9' ? 0.7 : 1;
    const byAudio = p.keepAudio ? 1 : 0.92;
    return Math.round(input.bytes * byQuality * byCodec * byAudio);
  },

  outputExtension: (p: P) => p.format,
  copyStatus: 'final',

  seo: {
    title: 'Video converter — MP4, WebM, MKV, MOV, AVI | Editz',
    h1: 'Convert video',
    description:
      'Change a video between MP4, WebM, MKV, MOV and AVI in your browser. No upload, no watermark on the free tier, no account.',
    intro: [
      'A video file has two parts that people tend to confuse: the container and the codec. The container is the wrapper — MP4, MKV, WebM, MOV, AVI — and it decides which players will open the file at all. The codec is how the picture itself is compressed, and it decides how big the file is and how much hardware it takes to play. Converting a video means unwrapping it, re-encoding the picture and sound into the codecs the new container expects, and wrapping it back up.',
      'Editz picks the codec for you based on the container, because the combinations that actually play back reliably are a much shorter list than the combinations that are technically legal. MP4, MOV and MKV get H.264 video with AAC audio, which is the pairing that plays on essentially every phone, TV and browser made in the last decade. WebM gets VP9 and Opus, which is noticeably smaller for the same quality and is the right choice for a video going on a website — at the cost of being slower to encode. AVI gets H.264 with MP3 audio for older software that expects it.',
      'The conversion runs on your device, so the file is never uploaded and it costs you nothing in data.',
    ].join('\n\n'),
    steps: [
      'Choose the video you want to convert. It is read locally — the meter shows 0 MB uploaded.',
      'Pick the format you need and a quality level.',
      'Press Convert video and the new file downloads when it is done.',
    ],
    faq: [
      {
        q: 'Which format should I choose?',
        a: 'MP4 unless you have a reason not to — it plays on everything. Choose WebM for a video you are putting on a website, because it is meaningfully smaller. Choose MOV if you are taking the file into Apple editing software, and AVI only if some older program has demanded it.',
      },
      {
        q: 'Will converting make the file smaller?',
        a: 'Usually, because it re-encodes at a modern codec and a sensible bitrate. If you specifically want a smaller file rather than a different format, use the video compressor instead — it lets you aim at a quality level or an exact file size.',
      },
      {
        q: 'Does converting lose quality?',
        a: 'Yes, a little, because the picture is decoded and re-compressed. At the high setting the loss is very hard to see. Converting the same file back and forth repeatedly will degrade it, so convert from your original rather than from a previous conversion.',
      },
      {
        q: 'Can I convert a video to MP3?',
        a: 'Use the extract audio tool. It pulls the sound out and discards the picture, which is faster and gives a much better result than pretending a video is an audio file.',
      },
      {
        q: 'Is anything uploaded?',
        a: 'Not for MP4, MOV, MKV or AVI — those convert in your browser and nothing leaves your device. WebM is the exception: the browser engine cannot encode VP9 reliably, so those go to our servers. The meter tells you which is happening, in megabytes, before you start.',
      },
    ],
    related: ['compress-video', 'audio-converter', 'extract-audio', 'gif-maker'],
    keywords: [
      'video converter online',
      'convert mp4 to webm',
      'convert mov to mp4',
      'free video converter no upload',
      'change video format',
    ],
  },
});
