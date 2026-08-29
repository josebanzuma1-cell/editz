import { z } from 'zod';
import type { ImageFormat, MediaInput, Operation } from '@editz/engine-core';
import { defineTool } from '../../types';

const params = z.object({
  mode: z.enum(['dimensions', 'percent']),
  width: z.number().int().min(1).max(16000),
  height: z.number().int().min(1).max(16000),
  percent: z.number().int().min(1).max(400),
  fit: z.enum(['contain', 'cover', 'stretch']),
  format: z.enum(['keep', 'jpeg', 'png', 'webp']),
  quality: z.number().int().min(40).max(100),
});

type P = z.infer<typeof params>;

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

function targetSize(input: MediaInput, p: P): { width: number; height: number } {
  if (p.mode === 'percent') {
    const w = input.width ?? p.width;
    const h = input.height ?? p.height;
    return {
      width: Math.max(1, Math.round((w * p.percent) / 100)),
      height: Math.max(1, Math.round((h * p.percent) / 100)),
    };
  }
  return { width: p.width, height: p.height };
}

export const resizeImage = defineTool({
  slug: 'resize-image',
  name: 'Resize image',
  kind: 'image',
  category: 'image',
  icon: 'scaling',
  accepts: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp'],
  multiFile: false,

  // Images are small and Canvas handles them without wasm. There is no
  // sensible reason for a resize to ever touch a server.
  execution: 'client',

  params,
  defaults: {
    mode: 'dimensions',
    width: 1080,
    height: 1080,
    percent: 50,
    fit: 'contain',
    format: 'keep',
    quality: 85,
  },

  ui: {
    controls: [
      {
        key: 'mode',
        kind: 'segmented',
        label: 'Resize by',
        options: [
          { value: 'dimensions', label: 'Pixels' },
          { value: 'percent', label: 'Percentage' },
        ],
      },
      {
        key: 'width',
        kind: 'number',
        label: 'Width',
        unit: 'px',
        min: 1,
        max: 16000,
        showIf: (p) => p.mode === 'dimensions',
      },
      {
        key: 'height',
        kind: 'number',
        label: 'Height',
        unit: 'px',
        min: 1,
        max: 16000,
        showIf: (p) => p.mode === 'dimensions',
      },
      {
        key: 'percent',
        kind: 'number',
        label: 'Scale',
        unit: '%',
        min: 1,
        max: 400,
        showIf: (p) => p.mode === 'percent',
      },
      {
        key: 'fit',
        kind: 'segmented',
        label: 'Fit',
        showIf: (p) => p.mode === 'dimensions',
        options: [
          { value: 'contain', label: 'Fit inside', hint: 'Keeps the whole picture' },
          { value: 'cover', label: 'Fill and crop', hint: 'Fills the frame exactly' },
          { value: 'stretch', label: 'Stretch', hint: 'Ignores the aspect ratio' },
        ],
      },
      {
        key: 'format',
        kind: 'select',
        label: 'Format',
        options: [
          { value: 'keep', label: 'Keep original' },
          { value: 'jpeg', label: 'JPEG' },
          { value: 'png', label: 'PNG' },
          { value: 'webp', label: 'WebP' },
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

  buildOps: (input: MediaInput, p: P): Operation[] => {
    const { width, height } = targetSize(input, p);
    const ops: Operation[] = [];

    if (p.mode === 'percent' || p.fit === 'stretch') {
      ops.push({ stage: 'filter', op: 'scale', width, height, flags: 'lanczos' });
    } else {
      ops.push({ stage: 'filter', op: 'fit', width, height, mode: p.fit });
    }

    const format: ImageFormat =
      p.format === 'keep' ? (input.mime === 'image/png' ? 'png' : 'jpeg') : p.format;

    ops.push({
      stage: 'encode',
      op: 'image',
      format,
      // PNG is lossless; a quality number there means nothing.
      ...(format === 'png' ? {} : { quality: p.quality }),
    });

    return ops;
  },

  estimateOutput: (input: MediaInput, p: P) => {
    const { width, height } = targetSize(input, p);
    if (!input.width || !input.height) return null;
    const pixelRatio = (width * height) / (input.width * input.height);
    const qualityRatio = p.format === 'png' ? 1 : (p.quality / 85) ** 1.4;
    const formatRatio = p.format === 'webp' ? 0.7 : p.format === 'png' ? 2.2 : 1;
    return Math.max(1024, Math.round(input.bytes * pixelRatio * qualityRatio * formatRatio));
  },

  outputExtension: (p: P, input: MediaInput) =>
    p.format === 'keep' ? (EXT_BY_MIME[input.mime] ?? 'jpg') : p.format === 'jpeg' ? 'jpg' : p.format,
  copyStatus: 'final',

  seo: {
    title: 'Resize image online — free, private, no upload | Editz',
    h1: 'Resize image',
    description:
      'Change the pixel dimensions of a JPG, PNG or WebP in your browser. Nothing is uploaded and there is no watermark.',
    intro: [
      'Resizing an image changes how many pixels it contains. That is not the same as compressing it, and it is not the same as cropping it: compressing keeps every pixel but stores them more cheaply, cropping throws away the edges, and resizing rebuilds the whole picture at a different pixel count. Resizing is what you want when something has to be exactly 1080 by 1080 for a profile picture, or when a 12-megapixel phone photo is being attached to a form that expects something a fraction of that.',
      'How the picture meets the frame matters when the shape you are asking for is not the shape you started with. Fit inside keeps the entire image and leaves the frame partly empty. Fill and crop scales up until the frame is full and trims what hangs over the edges, which is what social platforms do to your header image whether you asked or not. Stretch simply squashes the picture into the frame and is almost never what anyone wants, but it is there for the rare case where it is.',
      'This tool runs entirely in your browser using Canvas. There is no upload step, no queue, and no server involved — your photo never leaves your device, which matters if it is a passport scan or an ID photo.',
    ].join('\n\n'),
    steps: [
      'Choose an image, or drop one onto the page. It is read straight from your device.',
      'Enter the width and height you need, or switch to a percentage, and pick how the picture should fit.',
      'Press Resize image and the new file downloads immediately.',
    ],
    faq: [
      {
        q: 'Is my image uploaded?',
        a: 'No. Never, for this tool. Image resizing is done with Canvas in your own browser, so there is no server involved at any point and the meter on the page stays at zero megabytes. That holds even for very large images.',
      },
      {
        q: 'Will resizing make my image blurry?',
        a: 'Making an image smaller is safe and usually looks sharper than the original at its new size. Making it larger cannot invent detail that was never captured, so anything above about 150% will look soft. If you need a bigger image, start from a bigger original.',
      },
      {
        q: 'What is the difference between resizing and compressing?',
        a: 'Resizing changes the number of pixels. Compressing keeps the pixels and stores them with more or less accuracy. If your goal is a smaller file rather than specific dimensions, use compress image — and if a form has rejected your photo for being too large, doing both is usually the answer.',
      },
      {
        q: 'Which format should I save as?',
        a: 'JPEG for photographs, PNG for screenshots, logos and anything with sharp edges or transparency, WebP when you want a smaller file and you know where it is going. Keep original leaves the format alone, which is the safe default.',
      },
      {
        q: 'Can I resize several images at once?',
        a: 'Not yet — this tool takes one at a time. Batch resizing is coming.',
      },
    ],
    related: ['compress-image', 'crop-image', 'convert-image', 'resize-video'],
    keywords: [
      'resize image online',
      'resize image free',
      'change image dimensions',
      'resize jpg online',
      'resize photo without uploading',
    ],
  },
});
