import { z } from 'zod';
import type { ImageFormat, Operation } from '@editz/engine-core';
import { defineTool } from '../../types';

const IMAGE_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/bmp',
  'image/tiff',
];

const EXT: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

export { resizeImage } from './resize-image';

/* -------------------------------------------------------------------------- */
/* Crop image                                                                  */
/* -------------------------------------------------------------------------- */

const cropParams = z.object({
  aspect: z.enum(['free', '1:1', '4:3', '3:2', '16:9', '9:16', '4:5']),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});

export const cropImage = defineTool({
  slug: 'crop-image',
  name: 'Crop image',
  kind: 'image',
  category: 'image',
  icon: 'crop',
  accepts: IMAGE_MIME,
  multiFile: false,
  execution: 'client',
  params: cropParams,
  defaults: { aspect: '1:1', x: 0, y: 0, width: 1080, height: 1080 },
  ui: {
    controls: [
      {
        key: 'aspect',
        kind: 'select',
        label: 'Aspect ratio',
        options: [
          { value: 'free', label: 'Free' },
          { value: '1:1', label: 'Square', hint: 'Profile pictures' },
          { value: '4:5', label: 'Portrait', hint: 'Instagram feed' },
          { value: '4:3', label: 'Classic' },
          { value: '3:2', label: 'Photo' },
          { value: '16:9', label: 'Widescreen' },
          { value: '9:16', label: 'Vertical' },
        ],
      },
      { key: 'x', kind: 'number', label: 'Left', unit: 'px', min: 0, max: 16000 },
      { key: 'y', kind: 'number', label: 'Top', unit: 'px', min: 0, max: 16000 },
      { key: 'width', kind: 'number', label: 'Width', unit: 'px', min: 1, max: 16000 },
      { key: 'height', kind: 'number', label: 'Height', unit: 'px', min: 1, max: 16000 },
    ],
  },
  buildOps: (input, p): Operation[] => [
    { stage: 'filter', op: 'crop', x: p.x, y: p.y, width: p.width, height: p.height },
    {
      stage: 'encode',
      op: 'image',
      format: input.mime === 'image/png' ? 'png' : 'jpeg',
      quality: 92,
    },
  ],
  estimateOutput: (input, p) => {
    if (!input.width || !input.height) return null;
    return Math.round(input.bytes * ((p.width * p.height) / (input.width * input.height)));
  },
  outputExtension: (_p, input) => (input.mime === 'image/png' ? 'png' : 'jpg'),
  copyStatus: 'draft',
  seo: {
    title: 'Crop image online — free, private, no upload | Editz',
    h1: 'Crop image',
    description:
      'Cut an image down to the part you want, at any aspect ratio. Runs in your browser, nothing uploaded.',
    intro:
      'Cropping keeps a rectangle out of your image and throws the rest away. Unlike resizing it does not touch the pixels you keep, so the cropped area is exactly as sharp as it was. Fixed ratios matter more than they look: a profile picture that is not square will be squared by the platform, and it will not ask you which part to keep. Cropping it yourself first means you decide.',
    steps: [
      'Choose an image.',
      'Pick an aspect ratio and position the crop box.',
      'Press Crop image and download it.',
    ],
    faq: [
      {
        q: 'Is my photo uploaded?',
        a: 'No. Cropping is done with Canvas in your own browser, so the image never leaves your device — which matters if it is an ID document or a passport photo.',
      },
      {
        q: 'Does cropping reduce quality?',
        a: 'The pixels you keep are untouched. The result is smaller in dimensions because it genuinely contains less of the picture.',
      },
    ],
    related: ['resize-image', 'compress-image', 'convert-image', 'crop-video'],
    keywords: ['crop image online', 'crop photo free', 'square crop for profile picture'],
  },
});

/* -------------------------------------------------------------------------- */
/* Compress image                                                              */
/* -------------------------------------------------------------------------- */

const compressImageParams = z.object({
  mode: z.enum(['quality', 'size']),
  quality: z.number().int().min(30).max(95),
  targetSizeKb: z.number().int().min(10).max(20000).optional(),
  format: z.enum(['keep', 'jpeg', 'webp']),
});

export const compressImage = defineTool({
  slug: 'compress-image',
  name: 'Compress image',
  kind: 'image',
  category: 'image',
  icon: 'minimize-2',
  accepts: IMAGE_MIME,
  multiFile: false,
  execution: 'client',
  params: compressImageParams,
  defaults: { mode: 'quality', quality: 80, format: 'keep' },
  ui: {
    controls: [
      {
        key: 'mode',
        kind: 'segmented',
        label: 'Compress by',
        options: [
          { value: 'quality', label: 'Quality' },
          { value: 'size', label: 'File size' },
        ],
      },
      {
        key: 'quality',
        kind: 'number',
        label: 'Quality',
        unit: '%',
        min: 30,
        max: 95,
        step: 5,
        hint: '80 is the point where most people stop noticing',
        showIf: (p) => p.mode === 'quality',
      },
      {
        key: 'targetSizeKb',
        kind: 'number',
        label: 'Target size',
        unit: 'KB',
        min: 10,
        max: 20000,
        showIf: (p) => p.mode === 'size',
      },
      {
        key: 'format',
        kind: 'segmented',
        label: 'Format',
        options: [
          { value: 'keep', label: 'Keep' },
          { value: 'jpeg', label: 'JPEG' },
          { value: 'webp', label: 'WebP', hint: 'About 30% smaller' },
        ],
      },
    ],
  },
  buildOps: (input, p): Operation[] => {
    const format: ImageFormat =
      p.format === 'keep' ? (input.mime === 'image/png' ? 'png' : 'jpeg') : p.format;
    return [{ stage: 'encode', op: 'image', format, quality: p.quality }];
  },
  estimateOutput: (input, p) => {
    if (p.mode === 'size' && p.targetSizeKb != null) return p.targetSizeKb * 1024;
    const byQuality = (p.quality / 85) ** 1.6;
    const byFormat = p.format === 'webp' ? 0.7 : 1;
    return Math.max(2048, Math.round(input.bytes * byQuality * byFormat));
  },
  outputExtension: (p, input) =>
    p.format === 'keep' ? (input.mime === 'image/png' ? 'png' : 'jpg') : EXT[p.format],
  copyStatus: 'draft',
  seo: {
    title: 'Compress image online — smaller JPG, PNG and WebP | Editz',
    h1: 'Compress image',
    description:
      'Make an image file smaller without changing its dimensions. Runs in your browser, nothing uploaded.',
    intro:
      'Compressing an image keeps every pixel where it is and stores the colour information less precisely. Photographs take this very well: at 80 percent quality most people cannot tell the difference from the original, and the file is often a quarter of the size. Screenshots, logos and anything with sharp edges or text take it badly, because the artefacts land exactly where the eye is looking — keep those as PNG. Converting to WebP saves roughly another third again.',
    steps: [
      'Choose an image.',
      'Set a quality level, or aim at a file size.',
      'Press Compress image and download it.',
    ],
    faq: [
      {
        q: 'Will my image look worse?',
        a: 'At 80 percent, rarely, for photographs. Below about 60 you will start to see blocking in smooth areas like skies. Text and sharp edges suffer much sooner than photographs do.',
      },
      {
        q: 'My upload form says the file is too large. What should I do?',
        a: 'Compress first. If it is still too big, resize the dimensions as well — a 12-megapixel photo is far larger than any form needs.',
      },
      {
        q: 'Should I use WebP?',
        a: 'For a website, yes — every current browser supports it and it is meaningfully smaller. For a file you are emailing to someone, JPEG is the safer bet.',
      },
    ],
    related: ['resize-image', 'convert-image', 'crop-image', 'compress-video'],
    keywords: ['compress image online', 'reduce image file size', 'compress jpg free'],
  },
});

/* -------------------------------------------------------------------------- */
/* Convert image                                                               */
/* -------------------------------------------------------------------------- */

const convertImageParams = z.object({
  format: z.enum(['jpeg', 'png', 'webp', 'avif']),
  quality: z.number().int().min(40).max(100),
  background: z.enum(['white', 'black']),
});

export const convertImage = defineTool({
  slug: 'convert-image',
  name: 'Convert image',
  kind: 'image',
  category: 'image',
  icon: 'repeat',
  accepts: IMAGE_MIME,
  multiFile: false,
  execution: 'client',
  params: convertImageParams,
  defaults: { format: 'jpeg', quality: 90, background: 'white' },
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
      {
        key: 'background',
        kind: 'segmented',
        label: 'Behind transparency',
        hint: 'JPEG cannot store transparency, so it needs a colour',
        showIf: (p) => p.format === 'jpeg',
        options: [
          { value: 'white', label: 'White' },
          { value: 'black', label: 'Black' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] => {
    const ops: Operation[] = [];
    if (p.format === 'jpeg') {
      ops.push({ stage: 'filter', op: 'flatten', color: p.background });
    }
    ops.push({
      stage: 'encode',
      op: 'image',
      format: p.format,
      ...(p.format === 'png' ? {} : { quality: p.quality }),
    });
    return ops;
  },
  outputExtension: (p) => EXT[p.format],
  copyStatus: 'draft',
  seo: {
    title: 'Convert image online — JPG, PNG, WebP, AVIF | Editz',
    h1: 'Convert image',
    description:
      'Change an image between JPG, PNG, WebP and AVIF in your browser. Free, private, no upload.',
    intro:
      'Each image format is good at something different. JPEG is for photographs and is understood by everything, but it cannot store transparency. PNG is lossless and keeps transparency, which makes it right for logos, screenshots and anything with text — at a much larger file size. WebP does both jobs and is smaller than either. AVIF is smaller still and not yet supported everywhere. Converting a transparent PNG to JPEG has to fill the transparent parts with something, which is why you are asked for a colour.',
    steps: [
      'Choose an image.',
      'Pick the format you need.',
      'Press Convert image and download it.',
    ],
    faq: [
      {
        q: 'Why did my transparent background turn white?',
        a: 'JPEG has no way to store transparency, so it must be filled. Convert to PNG or WebP instead if you need to keep it.',
      },
      {
        q: 'Does converting PNG to JPEG lose quality?',
        a: 'Yes — JPEG is lossy. For a photograph at 90 percent the loss is invisible. For a screenshot with text it will not be, so keep those as PNG.',
      },
    ],
    related: ['image-converter', 'compress-image', 'resize-image', 'dpi-converter'],
    keywords: ['convert image online', 'png to jpg free', 'convert to webp'],
  },
});

/* -------------------------------------------------------------------------- */
/* DPI converter                                                               */
/* -------------------------------------------------------------------------- */

const dpiParams = z.object({
  dpi: z.number().int().min(72).max(1200),
  resample: z.boolean(),
});

export const dpiConverter = defineTool({
  slug: 'dpi-converter',
  name: 'Change image DPI',
  kind: 'image',
  category: 'image',
  icon: 'ruler',
  accepts: ['image/jpeg', 'image/png', 'image/tiff'],
  multiFile: false,
  execution: 'client',
  params: dpiParams,
  defaults: { dpi: 300, resample: false },
  ui: {
    controls: [
      {
        key: 'dpi',
        kind: 'select',
        label: 'DPI',
        valueType: 'number',
        options: [
          { value: '72', label: '72 — screen' },
          { value: '96', label: '96 — Windows screen' },
          { value: '150', label: '150 — draft print' },
          { value: '300', label: '300 — print' },
          { value: '600', label: '600 — fine print' },
        ],
      },
      {
        key: 'resample',
        kind: 'toggle',
        label: 'Resample the pixels too',
        hint: 'Off just relabels the file; on actually changes the pixel count',
      },
    ],
  },
  buildOps: (_input, p): Operation[] => [
    { stage: 'encode', op: 'image', format: 'jpeg', quality: 95, dpi: p.dpi },
  ],
  outputExtension: (_p, input) => (input.mime === 'image/png' ? 'png' : 'jpg'),
  copyStatus: 'draft',
  seo: {
    title: 'Change image DPI online — 300 DPI converter | Editz',
    h1: 'Change image DPI',
    description:
      'Set an image to 300 DPI or any other value for printing or submission. Runs in your browser.',
    intro:
      'DPI is a note stored inside the file saying how large it should be printed. It changes nothing about the pixels themselves — a 1000 by 1000 image is a 1000 by 1000 image at 72 DPI and at 300. What changes is the printed size: at 300 DPI that image prints at about 8.5 centimetres across, and at 72 it prints at nearly 35. Plenty of print shops and application forms simply check the DPI field, which is why relabelling is often all you need.',
    steps: [
      'Choose an image.',
      'Pick the DPI you have been asked for.',
      'Press Change image DPI and download it.',
    ],
    faq: [
      {
        q: 'Will setting 300 DPI make my image sharper?',
        a: 'No. DPI is only a label about print size. Sharpness comes from how many pixels the image actually has. If a print looks soft, you need a higher-resolution original.',
      },
      {
        q: 'What DPI does printing need?',
        a: '300 is the normal answer for photographs and documents. 150 is acceptable for large posters viewed from a distance, and 72 is for screens only.',
      },
    ],
    related: ['resize-image', 'convert-image', 'compress-image', 'crop-image'],
    keywords: ['change dpi online', '300 dpi converter free', 'set image dpi'],
  },
});
