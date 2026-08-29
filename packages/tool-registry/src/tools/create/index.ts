import { z } from 'zod';
import type { Operation, TextPosition } from '@editz/engine-core';
import { defineTool } from '../../types';

const VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'];
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/* -------------------------------------------------------------------------- */
/* Multi-track editor (M6)                                                     */
/* -------------------------------------------------------------------------- */

const editorParams = z.object({
  resolution: z.enum(['1080p', '720p', '4k']),
  fps: z.enum(['24', '30', '60']),
});

export const videoEditor = defineTool({
  slug: 'video-editor',
  name: 'Video editor',
  kind: 'video',
  category: 'create',
  icon: 'clapperboard',
  accepts: [...VIDEO_MIME, ...IMAGE_MIME, 'audio/mpeg', 'audio/wav'],
  multiFile: true,
  execution: 'auto',
  params: editorParams,
  defaults: { resolution: '1080p', fps: '30' },
  ui: {
    surface: 'app',
    controls: [
      {
        key: 'resolution',
        kind: 'segmented',
        label: 'Export at',
        options: [
          { value: '720p', label: '720p' },
          { value: '1080p', label: '1080p' },
          { value: '4k', label: '4K', hint: 'Pro' },
        ],
      },
      {
        key: 'fps',
        kind: 'segmented',
        label: 'Frame rate',
        options: [
          { value: '24', label: '24' },
          { value: '30', label: '30' },
          { value: '60', label: '60' },
        ],
      },
    ],
  },
  // The editor does not build ops from a single input — it compiles its
  // timeline document instead, which lands with the editor itself in M6. The
  // manifest exists now so the landing page, navigation and sitemap are real.
  buildOps: (): Operation[] => [],
  outputExtension: () => 'mp4',
  copyStatus: 'draft',
  seo: {
    title: 'Free online video editor — multi-track, no install | Editz',
    h1: 'Video editor',
    description:
      'Edit video on a proper timeline in your browser. Multiple tracks, text, music, no install and no watermark on export.',
    intro:
      'A full timeline editor that runs in a browser tab. Layer video, images, music and text on separate tracks, trim and slide clips against each other, and scrub the playhead to see the result immediately. Preview happens on your device so it stays responsive, and only the final export is a heavy job. If you have used a desktop editor the layout will be familiar; if you have not, the single-purpose tools do one thing each and are a gentler place to start.',
    steps: [
      'Add your clips, images and music to the timeline.',
      'Trim, arrange and layer them, and add text where you need it.',
      'Export, and download the finished video.',
    ],
    faq: [
      {
        q: 'Do I need to install anything?',
        a: 'No. It runs in the browser tab. There is nothing to download and it works the same on a laptop or a reasonably recent phone.',
      },
      {
        q: 'Are my projects saved?',
        a: 'Saved projects are a Pro feature. Without an account the timeline lives in the tab, so finish and export in one sitting.',
      },
    ],
    related: ['merge-video', 'slideshow-maker', 'add-music-to-video', 'cut-video'],
    keywords: ['free online video editor', 'browser video editor', 'video editor no watermark'],
  },
});

/* -------------------------------------------------------------------------- */
/* Slideshow maker                                                             */
/* -------------------------------------------------------------------------- */

const slideshowParams = z.object({
  secondsPerImage: z.number().min(0.5).max(30),
  transition: z.enum(['none', 'fade', 'slide']),
  resolution: z.enum(['1080p', '720p', 'square', 'story']),
  kenBurns: z.boolean(),
});

export const slideshowMaker = defineTool({
  slug: 'slideshow-maker',
  name: 'Slideshow maker',
  kind: 'image',
  category: 'create',
  icon: 'gallery-horizontal',
  accepts: [...IMAGE_MIME, 'audio/mpeg'],
  multiFile: true,
  execution: 'auto',
  params: slideshowParams,
  defaults: { secondsPerImage: 3, transition: 'fade', resolution: '1080p', kenBurns: false },
  ui: {
    controls: [
      {
        key: 'secondsPerImage',
        kind: 'number',
        label: 'Each photo',
        unit: 'sec',
        min: 0.5,
        max: 30,
        step: 0.5,
      },
      {
        key: 'transition',
        kind: 'segmented',
        label: 'Between photos',
        options: [
          { value: 'none', label: 'Cut' },
          { value: 'fade', label: 'Fade' },
          { value: 'slide', label: 'Slide' },
        ],
      },
      {
        key: 'resolution',
        kind: 'select',
        label: 'Size',
        options: [
          { value: '1080p', label: '1080p · widescreen' },
          { value: '720p', label: '720p · widescreen' },
          { value: 'square', label: 'Square · 1080×1080' },
          { value: 'story', label: 'Vertical · 1080×1920' },
        ],
      },
      { key: 'kenBurns', kind: 'toggle', label: 'Slow zoom on each photo' },
    ],
  },
  buildOps: (_input, p, inputs): Operation[] => {
    const size =
      p.resolution === 'square'
        ? { width: 1080, height: 1080 }
        : p.resolution === 'story'
          ? { width: 1080, height: 1920 }
          : p.resolution === '720p'
            ? { width: 1280, height: 720 }
            : { width: 1920, height: 1080 };
    return [
      { stage: 'input', op: 'framerateIn', fps: 1 / p.secondsPerImage },
      { stage: 'filter', op: 'fit', width: size.width, height: size.height, mode: 'contain' },
      { stage: 'filter', op: 'fps', fps: 30 },
      { stage: 'stream', op: 'concat', count: inputs?.length ?? 1, reencode: true },
      { stage: 'encode', op: 'video', codec: 'h264', crf: 22, preset: 'medium' },
      { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
    ];
  },
  outputExtension: () => 'mp4',
  copyStatus: 'draft',
  seo: {
    title: 'Slideshow maker — turn photos into a video with music | Editz',
    h1: 'Slideshow maker',
    description:
      'Make a video slideshow from your photos, with music and transitions. Runs in your browser.',
    intro:
      'A slideshow turns a set of photographs into a video that can be posted anywhere a video can. Choose how long each photo holds — three seconds is comfortable for most people, less if there are many — and how one becomes the next. A slow zoom on each still keeps the result from feeling static, which is the usual complaint about photo slideshows. Pick square or vertical if it is going on social media, where widescreen gets cropped.',
    steps: [
      'Add your photos and drag them into order.',
      'Set how long each one holds, choose a transition and a size.',
      'Press Slideshow maker and download the video.',
    ],
    faq: [
      {
        q: 'Can I add music?',
        a: 'Yes — add an audio file along with the photos and it plays underneath. If it is shorter than the slideshow, it loops.',
      },
      {
        q: 'What size should I use?',
        a: 'Square or vertical for social media, widescreen for anywhere it will be watched on a computer or TV.',
      },
    ],
    related: ['video-editor', 'add-music-to-video', 'gif-maker', 'stop-motion'],
    keywords: ['slideshow maker free', 'photos to video online', 'photo slideshow with music'],
  },
});

/* -------------------------------------------------------------------------- */
/* Meme maker                                                                  */
/* -------------------------------------------------------------------------- */

const memeParams = z.object({
  topText: z.string().max(120),
  bottomText: z.string().max(120),
  fontSize: z.number().int().min(16).max(160),
  style: z.enum(['classic', 'plain', 'boxed']),
});

export const memeMaker = defineTool({
  slug: 'meme-maker',
  name: 'Meme maker',
  kind: 'image',
  category: 'create',
  icon: 'type',
  accepts: [...IMAGE_MIME, ...VIDEO_MIME, 'image/gif'],
  multiFile: false,
  execution: 'client',
  params: memeParams,
  defaults: { topText: '', bottomText: '', fontSize: 48, style: 'classic' },
  ui: {
    controls: [
      { key: 'topText', kind: 'text', label: 'Top text', placeholder: 'When you', maxLength: 120 },
      {
        key: 'bottomText',
        kind: 'text',
        label: 'Bottom text',
        placeholder: 'and it works',
        maxLength: 120,
      },
      { key: 'fontSize', kind: 'number', label: 'Text size', unit: 'px', min: 16, max: 160, step: 2 },
      {
        key: 'style',
        kind: 'segmented',
        label: 'Style',
        options: [
          { value: 'classic', label: 'Classic', hint: 'White with a black outline' },
          { value: 'plain', label: 'Plain' },
          { value: 'boxed', label: 'Boxed', hint: 'White bars above and below' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] => {
    const ops: Operation[] = [];
    const common = {
      sizePx: p.fontSize,
      color: p.style === 'boxed' ? 'black' : 'white',
      ...(p.style === 'boxed' ? { boxColor: 'white' } : {}),
    };
    if (p.topText) {
      ops.push({
        stage: 'filter',
        op: 'drawText',
        text: p.topText,
        position: 'top' as TextPosition,
        ...common,
      });
    }
    if (p.bottomText) {
      ops.push({
        stage: 'filter',
        op: 'drawText',
        text: p.bottomText,
        position: 'bottom' as TextPosition,
        ...common,
      });
    }
    ops.push({ stage: 'encode', op: 'image', format: 'jpeg', quality: 92 });
    return ops;
  },
  outputExtension: () => 'jpg',
  copyStatus: 'draft',
  seo: {
    title: 'Meme maker — add text to an image online | Editz',
    h1: 'Meme maker',
    description:
      'Put top and bottom text on any image or clip. No watermark, no signup, runs in your browser.',
    intro:
      'Add text over the top and bottom of an image the way memes have always done it. Classic style is white text with a heavy black outline, which stays readable over any background — that outline is the whole reason the style exists. Boxed puts the text on white bars above and below, leaving the picture untouched. Nothing is uploaded and nothing is watermarked, so what you download is exactly what you made.',
    steps: [
      'Choose an image or a short clip.',
      'Type your top and bottom text and pick a style.',
      'Press Meme maker and download it.',
    ],
    faq: [
      {
        q: 'Is there a watermark?',
        a: 'No. Nothing is added to what you download, on any tier. The image you get back contains your picture and your text and nothing else.',
      },
      {
        q: 'Can I use a video instead of an image?',
        a: 'Yes. The text is drawn over every frame and you get a video back rather than a still, which is what you want for a clip going on social media.',
      },
    ],
    related: ['gif-maker', 'crop-image', 'resize-image', 'filter-video'],
    keywords: ['meme maker free', 'add text to image online', 'meme generator no watermark'],
  },
});

/* -------------------------------------------------------------------------- */
/* GIF maker                                                                   */
/* -------------------------------------------------------------------------- */

const gifParams = z.object({
  startSec: z.number().min(0),
  durationSec: z.number().min(0.5).max(30),
  fps: z.number().int().min(5).max(30),
  width: z.number().int().min(120).max(1080),
  dither: z.boolean(),
});

export const gifMaker = defineTool({
  slug: 'gif-maker',
  name: 'GIF maker',
  kind: 'video',
  category: 'create',
  icon: 'file-image',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: gifParams,
  defaults: { startSec: 0, durationSec: 5, fps: 15, width: 480, dither: true },
  ui: {
    controls: [
      { key: 'startSec', kind: 'time', label: 'Start', hintFromDuration: true },
      { key: 'durationSec', kind: 'number', label: 'Length', unit: 'sec', min: 0.5, max: 30, step: 0.5 },
      {
        key: 'fps',
        kind: 'number',
        label: 'Frame rate',
        min: 5,
        max: 30,
        hint: '12 to 15 is the usual trade between smooth and small',
      },
      { key: 'width', kind: 'number', label: 'Width', unit: 'px', min: 120, max: 1080, step: 20 },
      { key: 'dither', kind: 'toggle', label: 'Dither', hint: 'Smooths banding in gradients' },
    ],
  },
  buildOps: (_input, p): Operation[] => [
    { stage: 'input', op: 'seek', startSec: p.startSec },
    { stage: 'input', op: 'duration', seconds: p.durationSec },
    { stage: 'filter', op: 'fps', fps: p.fps },
    { stage: 'filter', op: 'scale', width: p.width, height: -2, flags: 'lanczos' },
    { stage: 'filter', op: 'palette', colors: 256, dither: p.dither },
    { stage: 'stream', op: 'dropAudio' },
    { stage: 'container', op: 'format', ext: 'gif' },
  ],
  estimateOutput: (_input, p) =>
    // GIF is a paletted, barely-compressed format. Roughly: pixels × frames,
    // heavily discounted for inter-frame similarity.
    Math.round(p.width * (p.width * 0.6) * p.fps * p.durationSec * 0.08),
  outputExtension: () => 'gif',
  copyStatus: 'draft',
  seo: {
    title: 'Video to GIF — make a GIF online free | Editz',
    h1: 'GIF maker',
    description: 'Turn a few seconds of video into a GIF, in your browser. No upload, no watermark.',
    intro:
      'A GIF stores every frame as a separate paletted image, which is why they get enormous so quickly. Three settings control the size and all of them are trade-offs: length, frame rate and width. Fifteen frames a second looks smooth enough for almost everything and halves the size against thirty. Four hundred and eighty pixels wide is plenty for something being viewed in a chat. Keep it under about five seconds and you will get a file people can actually load.',
    steps: [
      'Choose a video and set where the GIF should start.',
      'Set the length, frame rate and width.',
      'Press GIF maker and download it.',
    ],
    faq: [
      {
        q: 'Why is my GIF so large?',
        a: 'Because GIF barely compresses. Cut the length, drop the frame rate to 12 or 15, and reduce the width — each of those roughly halves the file.',
      },
      {
        q: 'Does a GIF have sound?',
        a: 'No, the format has no audio at all. If you need sound, keep it as a short video.',
      },
    ],
    related: ['cut-video', 'compress-video', 'meme-maker', 'video-converter'],
    keywords: ['video to gif online', 'make a gif free', 'mp4 to gif converter'],
  },
});

/* -------------------------------------------------------------------------- */
/* Stop motion                                                                 */
/* -------------------------------------------------------------------------- */

const stopMotionParams = z.object({
  fps: z.number().int().min(2).max(24),
  loop: z.boolean(),
  format: z.enum(['mp4', 'gif']),
});

export const stopMotion = defineTool({
  slug: 'stop-motion',
  name: 'Stop motion maker',
  kind: 'image',
  category: 'create',
  icon: 'film',
  accepts: IMAGE_MIME,
  multiFile: true,
  execution: 'auto',
  params: stopMotionParams,
  defaults: { fps: 8, loop: true, format: 'mp4' },
  ui: {
    controls: [
      {
        key: 'fps',
        kind: 'number',
        label: 'Frames per second',
        min: 2,
        max: 24,
        hint: '8 to 12 reads as deliberate; below 6 reads as jerky',
      },
      { key: 'loop', kind: 'toggle', label: 'Loop back to the start' },
      {
        key: 'format',
        kind: 'segmented',
        label: 'Save as',
        options: [
          { value: 'mp4', label: 'MP4' },
          { value: 'gif', label: 'GIF' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] => {
    const ops: Operation[] = [{ stage: 'input', op: 'framerateIn', fps: p.fps }];
    if (p.loop) ops.push({ stage: 'input', op: 'loop', count: 2 });
    if (p.format === 'gif') {
      ops.push({ stage: 'filter', op: 'palette', colors: 256, dither: true });
      ops.push({ stage: 'container', op: 'format', ext: 'gif' });
    } else {
      ops.push({ stage: 'encode', op: 'video', codec: 'h264', crf: 20, preset: 'medium' });
      ops.push({ stage: 'container', op: 'format', ext: 'mp4', faststart: true });
    }
    return ops;
  },
  outputExtension: (p) => p.format,
  copyStatus: 'draft',
  seo: {
    title: 'Stop motion maker — turn photos into animation | Editz',
    h1: 'Stop motion maker',
    description:
      'Turn a sequence of photos into a stop motion animation. Runs in your browser, nothing uploaded.',
    intro:
      'Stop motion plays a series of stills fast enough to read as movement. The frame rate is the whole craft: eight to twelve frames a second is the classic look, deliberate and slightly stepped, while anything below six starts to read as a fault rather than a style. Shoot with the camera fixed in place and move the subject a small amount between frames — the smaller the movement, the smoother the result and the more photographs you will need.',
    steps: [
      'Add your photos in shooting order.',
      'Set the frame rate and choose MP4 or GIF.',
      'Press Stop motion maker and download it.',
    ],
    faq: [
      {
        q: 'How many photos do I need?',
        a: 'At 8 frames a second, eighty photos gives you ten seconds. Stop motion is slow work — a short piece is a real achievement.',
      },
      {
        q: 'MP4 or GIF?',
        a: 'MP4 unless it specifically has to be a GIF. It is far smaller and plays everywhere.',
      },
    ],
    related: ['slideshow-maker', 'gif-maker', 'video-editor', 'loop-video'],
    keywords: ['stop motion maker free', 'photos to animation online', 'stop motion from images'],
  },
});
