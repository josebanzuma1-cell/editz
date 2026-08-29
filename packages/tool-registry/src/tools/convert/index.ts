import { z } from 'zod';
import type { AudioCodec, ContainerExt, ImageFormat, Operation } from '@editz/engine-core';
import { defineTool } from '../../types';

export { videoConverter } from './video-converter';

/* -------------------------------------------------------------------------- */
/* Audio converter                                                             */
/* -------------------------------------------------------------------------- */

const audioParams = z.object({
  format: z.enum(['mp3', 'aac', 'opus', 'flac']),
  bitrate: z.enum(['96', '128', '192', '320']),
  sampleRate: z.enum(['keep', '44100', '48000']),
});

const AUDIO_EXT: Record<Exclude<AudioCodec, 'copy'>, ContainerExt> = {
  mp3: 'mp3',
  aac: 'm4a',
  opus: 'opus',
  flac: 'flac',
};

export const audioConverter = defineTool({
  slug: 'audio-converter',
  name: 'Convert audio',
  kind: 'audio',
  category: 'convert',
  icon: 'repeat',
  accepts: [
    'audio/mpeg',
    'audio/wav',
    'audio/aac',
    'audio/ogg',
    'audio/flac',
    'audio/mp4',
    'audio/x-m4a',
    'audio/amr',
  ],
  multiFile: false,
  execution: 'auto',
  params: audioParams,
  defaults: { format: 'mp3', bitrate: '192', sampleRate: 'keep' },
  ui: {
    controls: [
      {
        key: 'format',
        kind: 'segmented',
        label: 'Convert to',
        options: [
          { value: 'mp3', label: 'MP3', hint: 'Plays everywhere' },
          { value: 'aac', label: 'M4A', hint: 'Apple default' },
          { value: 'opus', label: 'Opus', hint: 'Smallest for the quality' },
          { value: 'flac', label: 'FLAC', hint: 'Lossless' },
        ],
      },
      {
        key: 'bitrate',
        kind: 'segmented',
        label: 'Bitrate',
        showIf: (p) => p.format !== 'flac',
        options: [
          { value: '96', label: '96k', hint: 'Speech' },
          { value: '128', label: '128k' },
          { value: '192', label: '192k' },
          { value: '320', label: '320k', hint: 'Music' },
        ],
      },
      {
        key: 'sampleRate',
        kind: 'select',
        label: 'Sample rate',
        options: [
          { value: 'keep', label: 'Keep original' },
          { value: '44100', label: '44.1 kHz — CD' },
          { value: '48000', label: '48 kHz — video' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] => [
    {
      stage: 'encode',
      op: 'audio',
      codec: p.format,
      ...(p.format === 'flac' ? {} : { bitrateKbps: Number(p.bitrate) }),
      ...(p.sampleRate === 'keep' ? {} : { sampleRateHz: Number(p.sampleRate) }),
    },
    { stage: 'container', op: 'format', ext: AUDIO_EXT[p.format] },
  ],
  estimateOutput: (input, p) => {
    if (!input.durationSec) return null;
    const kbps = p.format === 'flac' ? 800 : Number(p.bitrate);
    return Math.round((kbps * 1000 * input.durationSec) / 8);
  },
  outputExtension: (p) => AUDIO_EXT[p.format],
  copyStatus: 'draft',
  seo: {
    title: 'Audio converter — MP3, M4A, Opus, FLAC online | Editz',
    h1: 'Convert audio',
    description:
      'Change an audio file between MP3, M4A, Opus, WAV and FLAC in your browser. Free, no upload.',
    intro:
      'Converting audio decodes the file and re-encodes it in a different format. Which one you want depends on where it is going. MP3 is universally supported and the safe default. M4A is what Apple devices produce and prefer. Opus gives the same quality as MP3 in a much smaller file and is ideal for speech, though not everything plays it. FLAC is lossless, so it is identical to the source and several times larger. Bitrate matters more than format for how it sounds: 96k is fine for a voice note and wasteful nowhere, 320k is for music you care about.',
    steps: [
      'Choose your audio file.',
      'Pick a format and bitrate.',
      'Press Convert audio and download it.',
    ],
    faq: [
      {
        q: 'Can converting improve the quality?',
        a: 'No. Converting a 128k MP3 to FLAC gives you a much larger file that sounds exactly the same. Quality can only be preserved or lost, never added.',
      },
      {
        q: 'Which bitrate should I choose?',
        a: '96k for speech, 192k for general listening, 320k for music you want to keep. Above 320k in a lossy format buys nothing.',
      },
    ],
    related: ['extract-audio', 'cut-audio', 'video-converter', 'merge-audio'],
    keywords: ['audio converter online', 'convert wav to mp3 free', 'm4a to mp3'],
  },
});

/* -------------------------------------------------------------------------- */
/* Image converter                                                             */
/* -------------------------------------------------------------------------- */

const imageParams = z.object({
  format: z.enum(['jpeg', 'png', 'webp', 'avif']),
  quality: z.number().int().min(40).max(100),
});

const IMAGE_EXT: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

export const imageConverter = defineTool({
  slug: 'image-converter',
  name: 'Image converter',
  kind: 'image',
  category: 'convert',
  icon: 'images',
  accepts: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/bmp',
    'image/tiff',
    'image/heic',
  ],
  multiFile: true,
  execution: 'client',
  params: imageParams,
  defaults: { format: 'webp', quality: 85 },
  ui: {
    controls: [
      {
        key: 'format',
        kind: 'segmented',
        label: 'Convert to',
        options: [
          { value: 'jpeg', label: 'JPEG' },
          { value: 'png', label: 'PNG' },
          { value: 'webp', label: 'WebP' },
          { value: 'avif', label: 'AVIF' },
        ],
      },
      {
        key: 'quality',
        kind: 'number',
        label: 'Quality',
        unit: '%',
        min: 40,
        max: 100,
        step: 5,
        showIf: (p) => p.format !== 'png',
      },
    ],
  },
  buildOps: (_input, p): Operation[] => [
    {
      stage: 'encode',
      op: 'image',
      format: p.format,
      ...(p.format === 'png' ? {} : { quality: p.quality }),
    },
  ],
  outputExtension: (p) => IMAGE_EXT[p.format],
  copyStatus: 'draft',
  seo: {
    title: 'Image converter — batch convert HEIC, PNG, JPG, WebP | Editz',
    h1: 'Image converter',
    description:
      'Convert several images at once between HEIC, JPG, PNG, WebP and AVIF. Runs entirely in your browser.',
    intro:
      'This is the batch version: drop in a folder of images and get them all back in one format. The common case is HEIC, the format iPhones save photos in, which Windows and a lot of websites still refuse to open — converting the lot to JPEG solves it in one pass. The other common case is preparing images for a website, where converting everything to WebP typically cuts the total weight by about a third with no visible difference. Nothing is uploaded, so a hundred photos costs you no data at all.',
    steps: [
      'Drop in as many images as you like.',
      'Pick the format they should all become.',
      'Press Image converter and download them.',
    ],
    faq: [
      {
        q: 'Can I convert HEIC photos from my iPhone?',
        a: 'Yes, if your browser can decode HEIC — Safari always can, and recent versions of Chrome and Edge usually can. Convert to JPEG for maximum compatibility.',
      },
      {
        q: 'How many images can I do at once?',
        a: 'As many as your device has memory for. They are processed one after another, so a large batch takes proportionally longer but will not run out of memory.',
      },
    ],
    related: ['convert-image', 'compress-image', 'resize-image', 'video-converter'],
    keywords: ['image converter online', 'heic to jpg free', 'batch convert images to webp'],
  },
});
