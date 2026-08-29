/**
 * The rest of the video edit tools.
 *
 * Manifests are grouped by category while their SEO copy is still at draft
 * length; each one moves into its own file when it gets the full copy pass
 * (see `compress-video.ts` and `cut-video.ts` for the finished shape).
 * `pnpm copy:audit` lists which ones are still waiting.
 */
import { z } from 'zod';
import type { MediaInput, Operation } from '@editz/engine-core';
import { defineTool } from '../../types';

const VIDEO_MIME = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
];

const mp4Out = (): string => 'mp4';

export { compressVideo } from './compress-video';
export { cutVideo } from './cut-video';

/* -------------------------------------------------------------------------- */
/* Resize                                                                      */
/* -------------------------------------------------------------------------- */

const resizeParams = z.object({
  preset: z.enum(['custom', '2160p', '1080p', '720p', '480p', 'square', 'story', 'landscape']),
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(4320),
  fit: z.enum(['contain', 'cover']),
});

type ResizePreset = Exclude<z.infer<typeof resizeParams>['preset'], 'custom'>;

const RESIZE_PRESETS: Record<ResizePreset, { width: number; height: number }> = {
  '2160p': { width: 3840, height: 2160 },
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
  '480p': { width: 854, height: 480 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
};

export const resizeVideo = defineTool({
  slug: 'resize-video',
  name: 'Resize video',
  kind: 'video',
  category: 'edit',
  icon: 'scaling',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: resizeParams,
  defaults: { preset: '720p', width: 1280, height: 720, fit: 'contain' },
  ui: {
    controls: [
      {
        key: 'preset',
        kind: 'select',
        label: 'Size',
        options: [
          { value: '2160p', label: '4K · 3840×2160' },
          { value: '1080p', label: '1080p · 1920×1080' },
          { value: '720p', label: '720p · 1280×720' },
          { value: '480p', label: '480p · 854×480' },
          { value: 'square', label: 'Square · 1080×1080', hint: 'Instagram feed' },
          { value: 'story', label: 'Vertical · 1080×1920', hint: 'Stories, Reels, TikTok' },
          { value: 'custom', label: 'Custom' },
        ],
      },
      {
        key: 'width',
        kind: 'number',
        label: 'Width',
        unit: 'px',
        min: 16,
        max: 7680,
        showIf: (p) => p.preset === 'custom',
      },
      {
        key: 'height',
        kind: 'number',
        label: 'Height',
        unit: 'px',
        min: 16,
        max: 4320,
        showIf: (p) => p.preset === 'custom',
      },
      {
        key: 'fit',
        kind: 'segmented',
        label: 'Fit',
        options: [
          { value: 'contain', label: 'Letterbox', hint: 'Keeps the whole frame' },
          { value: 'cover', label: 'Fill and crop', hint: 'No bars, trims the edges' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] => {
    const size = p.preset === 'custom' ? { width: p.width, height: p.height } : RESIZE_PRESETS[p.preset];
    return [
      { stage: 'filter', op: 'fit', width: size.width, height: size.height, mode: p.fit },
      { stage: 'encode', op: 'video', codec: 'h264', crf: 23, preset: 'medium' },
      { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 128 },
      { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
    ];
  },
  estimateOutput: (input: MediaInput, p) => {
    if (!input.width || !input.height) return null;
    const size = p.preset === 'custom' ? { width: p.width, height: p.height } : RESIZE_PRESETS[p.preset];
    const ratio = (size.width * size.height) / (input.width * input.height);
    return Math.round(input.bytes * Math.min(1.2, ratio ** 0.8));
  },
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Resize video online — 1080p, 720p, square, vertical | Editz',
    h1: 'Resize video',
    description:
      'Change a video to 1080p, 720p, square or vertical in your browser. No upload, no watermark, no account.',
    intro:
      'Resizing changes the pixel dimensions of your video. Use it when a platform expects a particular shape — square for an Instagram feed post, 1080×1920 for Stories, Reels and TikTok — or when 4K footage is far larger than anything it is going to be watched on. Letterbox keeps your whole frame and adds bars; fill and crop trims the edges so the frame is filled edge to edge. The work happens on your device, so nothing is uploaded.',
    steps: [
      'Choose your video.',
      'Pick a size preset, or enter your own dimensions, and choose how the frame should fit.',
      'Press Resize video and download the result.',
    ],
    faq: [
      {
        q: 'Which size should I use for Instagram?',
        a: 'Square (1080×1080) for a feed post and vertical (1080×1920) for Stories and Reels. Fill and crop avoids bars, but check that nothing important is near the edges first.',
      },
      {
        q: 'Does resizing make the file smaller?',
        a: 'Usually, because there are fewer pixels to store. If your goal is specifically a smaller file, compress video gives you direct control over the size.',
      },
    ],
    related: ['compress-video', 'crop-video', 'video-converter', 'resize-image'],
    keywords: ['resize video online', 'resize video for instagram', 'change video resolution'],
  },
});

/* -------------------------------------------------------------------------- */
/* Crop                                                                        */
/* -------------------------------------------------------------------------- */

const cropParams = z.object({
  aspect: z.enum(['free', '1:1', '16:9', '9:16', '4:5', '4:3']),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(16),
  height: z.number().int().min(16),
});

export const cropVideo = defineTool({
  slug: 'crop-video',
  name: 'Crop video',
  kind: 'video',
  category: 'edit',
  icon: 'crop',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: cropParams,
  defaults: { aspect: 'free', x: 0, y: 0, width: 1080, height: 1080 },
  ui: {
    controls: [
      {
        key: 'aspect',
        kind: 'select',
        label: 'Aspect ratio',
        options: [
          { value: 'free', label: 'Free' },
          { value: '1:1', label: 'Square' },
          { value: '16:9', label: 'Widescreen' },
          { value: '9:16', label: 'Vertical' },
          { value: '4:5', label: 'Portrait' },
          { value: '4:3', label: 'Classic' },
        ],
      },
      { key: 'x', kind: 'number', label: 'Left', unit: 'px', min: 0, max: 7680 },
      { key: 'y', kind: 'number', label: 'Top', unit: 'px', min: 0, max: 4320 },
      { key: 'width', kind: 'number', label: 'Width', unit: 'px', min: 16, max: 7680 },
      { key: 'height', kind: 'number', label: 'Height', unit: 'px', min: 16, max: 4320 },
    ],
  },
  buildOps: (_input, p): Operation[] => [
    { stage: 'filter', op: 'crop', x: p.x, y: p.y, width: p.width, height: p.height },
    { stage: 'encode', op: 'video', codec: 'h264', crf: 22, preset: 'medium' },
    { stage: 'encode', op: 'audio', codec: 'copy' },
    { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
  ],
  estimateOutput: (input, p) => {
    if (!input.width || !input.height) return null;
    const ratio = (p.width * p.height) / (input.width * input.height);
    return Math.round(input.bytes * Math.min(1, ratio ** 0.8));
  },
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Crop video online — free, no upload | Editz',
    h1: 'Crop video',
    description:
      'Trim the edges off a video and change its shape, in your browser. Nothing is uploaded and there is no watermark.',
    intro:
      'Cropping cuts away the outside of the frame and keeps what is left. It is how you turn landscape footage into something that fills a phone screen, straighten up a badly framed shot, or remove a logo, a timestamp or a bystander from the edge. Cropping never re-scales what remains, so the part you keep is exactly as sharp as it was. Pick an aspect ratio if the result has to fit a particular platform.',
    steps: [
      'Choose your video.',
      'Pick an aspect ratio, or set the crop box by hand.',
      'Press Crop video and download the result.',
    ],
    faq: [
      {
        q: 'Does cropping lose quality?',
        a: 'The pixels you keep are untouched, though the video is re-encoded once, which costs a very small amount. Cropping a small area out of a large frame gives you a small video — the picture is not enlarged to compensate.',
      },
      {
        q: 'How do I turn a landscape video vertical?',
        a: 'Crop to the 9:16 vertical ratio, then position the box over the part of the frame that matters. If you would rather keep the whole frame, use resize video with letterboxing instead.',
      },
    ],
    related: ['resize-video', 'cut-video', 'crop-image', 'compress-video'],
    keywords: ['crop video online', 'crop video free', 'make video vertical'],
  },
});

/* -------------------------------------------------------------------------- */
/* Split                                                                       */
/* -------------------------------------------------------------------------- */

const splitParams = z.object({
  mode: z.enum(['duration', 'parts']),
  seconds: z.number().int().min(1).max(3600),
  parts: z.number().int().min(2).max(50),
});

export const splitVideo = defineTool({
  slug: 'split-video',
  name: 'Split video',
  kind: 'video',
  category: 'edit',
  icon: 'split',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: splitParams,
  defaults: { mode: 'duration', seconds: 30, parts: 2 },
  ui: {
    controls: [
      {
        key: 'mode',
        kind: 'segmented',
        label: 'Split by',
        options: [
          { value: 'duration', label: 'Length' },
          { value: 'parts', label: 'Number of parts' },
        ],
      },
      {
        key: 'seconds',
        kind: 'number',
        label: 'Each part',
        unit: 'sec',
        min: 1,
        max: 3600,
        hint: 'WhatsApp status caps at 30 seconds',
        showIf: (p) => p.mode === 'duration',
      },
      {
        key: 'parts',
        kind: 'number',
        label: 'Parts',
        min: 2,
        max: 50,
        showIf: (p) => p.mode === 'parts',
      },
    ],
  },
  buildOps: (input, p): Operation[] => {
    const seconds =
      p.mode === 'duration'
        ? p.seconds
        : Math.max(1, Math.ceil((input.durationSec ?? p.parts) / p.parts));
    return [
      // A stream copy, so splitting is instant and lossless.
      { stage: 'encode', op: 'video', codec: 'copy' },
      { stage: 'encode', op: 'audio', codec: 'copy' },
      { stage: 'container', op: 'segment', seconds },
    ];
  },
  estimateOutput: (input) => input.bytes,
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Split video into parts online — free | Editz',
    h1: 'Split video',
    description:
      'Cut a long video into equal parts for status posts and uploads. Runs in your browser, nothing is uploaded.',
    intro:
      'Splitting breaks one long video into several shorter files. The usual reason is a platform limit — WhatsApp status takes 30 seconds at a time, and plenty of upload forms cap the length rather than the size. Editz splits by copying the video data rather than re-encoding it, so it finishes almost immediately, loses no quality at all, and works on large files even on a modest phone.',
    steps: [
      'Choose the video you want to split.',
      'Set how long each part should be, or how many parts you want.',
      'Press Split video and download the parts.',
    ],
    faq: [
      {
        q: 'Will the parts be exactly the length I asked for?',
        a: 'Very close. Because nothing is re-encoded, each part has to begin at a keyframe, so lengths can vary by a second or so either way.',
      },
      {
        q: 'How do I split for WhatsApp status?',
        a: 'Split by length and set 30 seconds, which is the status limit. Post the parts in order, waiting for each to finish uploading before you add the next, or they can arrive out of sequence.',
      },
    ],
    related: ['cut-video', 'merge-video', 'compress-video', 'video-converter'],
    keywords: ['split video online', 'split video for whatsapp status', 'cut video into parts'],
  },
});

/* -------------------------------------------------------------------------- */
/* Merge                                                                       */
/* -------------------------------------------------------------------------- */

const mergeParams = z.object({
  reencode: z.boolean(),
  resolution: z.enum(['first', '1080p', '720p']),
});

export const mergeVideo = defineTool({
  slug: 'merge-video',
  name: 'Merge video',
  kind: 'video',
  category: 'edit',
  icon: 'layers',
  accepts: VIDEO_MIME,
  multiFile: true,
  execution: 'auto',
  params: mergeParams,
  defaults: { reencode: true, resolution: 'first' },
  ui: {
    controls: [
      {
        key: 'reencode',
        kind: 'toggle',
        label: 'Re-encode to match',
        hint: 'Leave on unless every clip came from the same camera and settings',
      },
      {
        key: 'resolution',
        kind: 'segmented',
        label: 'Output size',
        showIf: (p) => p.reencode,
        options: [
          { value: 'first', label: 'Match the first clip' },
          { value: '1080p', label: '1080p' },
          { value: '720p', label: '720p' },
        ],
      },
    ],
  },
  buildOps: (_input, p, inputs): Operation[] => {
    const ops: Operation[] = [
      { stage: 'stream', op: 'concat', count: inputs?.length ?? 2, reencode: p.reencode },
    ];
    if (p.reencode) {
      if (p.resolution !== 'first') {
        const height = p.resolution === '1080p' ? 1080 : 720;
        ops.push({ stage: 'filter', op: 'fit', width: (height * 16) / 9, height, mode: 'contain' });
      }
      ops.push({ stage: 'encode', op: 'video', codec: 'h264', crf: 23, preset: 'medium' });
      ops.push({ stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 128 });
    } else {
      ops.push({ stage: 'encode', op: 'video', codec: 'copy' });
      ops.push({ stage: 'encode', op: 'audio', codec: 'copy' });
    }
    ops.push({ stage: 'container', op: 'format', ext: 'mp4', faststart: true });
    return ops;
  },
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Merge videos online — join clips into one file | Editz',
    h1: 'Merge video',
    description:
      'Join several clips into one video, in order, in your browser. No upload, no watermark, no account.',
    intro:
      'Merging joins clips end to end into a single file. The catch that trips people up on other sites is that videos can only be joined without re-encoding when they match exactly — same resolution, same frame rate, same codec. Clips from different phones almost never do. Leave re-encode on and Editz converts everything to a common format first, which takes longer but reliably produces one playable file instead of a broken one.',
    steps: [
      'Add your clips. Drag them into the order you want.',
      'Leave re-encode on unless every clip came from the same camera at the same settings.',
      'Press Merge video and download the joined file.',
    ],
    faq: [
      {
        q: 'Do the clips have to be the same size?',
        a: 'Not if re-encoding is on — differing clips are converted to a common format first. With it off they must match exactly or the result will not play properly.',
      },
      {
        q: 'Can I reorder the clips?',
        a: 'Yes, drag them in the list before you start. They are joined top to bottom.',
      },
    ],
    related: ['cut-video', 'split-video', 'merge-audio', 'video-editor'],
    keywords: ['merge videos online', 'join videos free', 'combine mp4 files'],
  },
});

/* -------------------------------------------------------------------------- */
/* Rotate / flip                                                               */
/* -------------------------------------------------------------------------- */

const rotateParams = z.object({ direction: z.enum(['cw', 'ccw', '180']) });

export const rotateVideo = defineTool({
  slug: 'rotate-video',
  name: 'Rotate video',
  kind: 'video',
  category: 'edit',
  icon: 'rotate-cw',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: rotateParams,
  defaults: { direction: 'cw' },
  ui: {
    controls: [
      {
        key: 'direction',
        kind: 'segmented',
        label: 'Rotate',
        options: [
          { value: 'cw', label: '90° right' },
          { value: 'ccw', label: '90° left' },
          { value: '180', label: '180°' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] => [
    { stage: 'filter', op: 'transpose', direction: p.direction },
    { stage: 'encode', op: 'video', codec: 'h264', crf: 22, preset: 'medium' },
    { stage: 'encode', op: 'audio', codec: 'copy' },
    { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
  ],
  estimateOutput: (input) => input.bytes,
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Rotate video online — fix sideways footage | Editz',
    h1: 'Rotate video',
    description:
      'Turn a sideways or upside-down video the right way up, in your browser. Nothing is uploaded.',
    intro:
      'Phones record an orientation flag rather than actually rotating the picture, which is why a clip can look correct on the phone that shot it and sideways everywhere else. Rotating with Editz turns the picture itself, so it is upright in every player, on every device, permanently. The rotation is applied on your device and the file is never uploaded.',
    steps: [
      'Choose the video that is the wrong way up.',
      'Pick which way to turn it.',
      'Press Rotate video and download the fixed file.',
    ],
    faq: [
      {
        q: 'Why does my video look fine on my phone but sideways on my laptop?',
        a: 'The phone wrote a rotation flag into the file and its own player obeys it. Many other players ignore it. Rotating the picture itself fixes it everywhere.',
      },
      {
        q: 'Does rotating lose quality?',
        a: 'The video is re-encoded once, which costs a small amount that is normally invisible.',
      },
    ],
    related: ['flip-video', 'crop-video', 'resize-video', 'compress-video'],
    keywords: ['rotate video online', 'fix sideways video', 'rotate mp4 free'],
  },
});

const flipParams = z.object({ axis: z.enum(['horizontal', 'vertical']) });

export const flipVideo = defineTool({
  slug: 'flip-video',
  name: 'Flip video',
  kind: 'video',
  category: 'edit',
  icon: 'flip-horizontal',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: flipParams,
  defaults: { axis: 'horizontal' },
  ui: {
    controls: [
      {
        key: 'axis',
        kind: 'segmented',
        label: 'Flip',
        options: [
          { value: 'horizontal', label: 'Left to right', hint: 'Un-mirrors selfie video' },
          { value: 'vertical', label: 'Top to bottom' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] => [
    {
      stage: 'filter',
      op: 'transpose',
      direction: p.axis === 'horizontal' ? 'hflip' : 'vflip',
    },
    { stage: 'encode', op: 'video', codec: 'h264', crf: 22, preset: 'medium' },
    { stage: 'encode', op: 'audio', codec: 'copy' },
    { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
  ],
  estimateOutput: (input) => input.bytes,
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Flip video online — mirror horizontally or vertically | Editz',
    h1: 'Flip video',
    description: 'Mirror a video left to right or top to bottom, in your browser. No upload.',
    intro:
      'Flipping mirrors the picture. The common reason is selfie footage: front cameras record what the lens sees rather than what you saw in the preview, so text in the shot comes out backwards and the whole thing feels subtly wrong. Flipping left to right puts it back. Vertical flipping is rarer and mostly used for reflections and effects.',
    steps: ['Choose your video.', 'Pick an axis to mirror on.', 'Press Flip video and download it.'],
    faq: [
      {
        q: 'Why is the writing in my selfie video backwards?',
        a: 'The front camera saved the true image rather than the mirrored preview you were watching while recording. Flip it left to right and the text reads correctly again.',
      },
      {
        q: 'Is flipping the same as rotating?',
        a: 'No. Rotating turns the picture through 90 or 180 degrees and the image stays the right way round. Flipping mirrors it, so left becomes right — which is why writing reverses when you flip but not when you rotate.',
      },
    ],
    related: ['rotate-video', 'crop-video', 'reverse-video', 'compress-video'],
    keywords: ['flip video online', 'mirror video free', 'unmirror selfie video'],
  },
});

/* -------------------------------------------------------------------------- */
/* Reverse / loop / speed                                                      */
/* -------------------------------------------------------------------------- */

const reverseParams = z.object({ reverseAudio: z.boolean() });

export const reverseVideo = defineTool({
  slug: 'reverse-video',
  name: 'Reverse video',
  kind: 'video',
  category: 'edit',
  icon: 'rewind',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  // Reversing holds every frame in memory at once. It is the one edit that
  // genuinely cannot stream, so the ceiling is much lower than usual.
  clientCeilingBytes: 60 * 1024 * 1024,
  params: reverseParams,
  defaults: { reverseAudio: false },
  ui: {
    controls: [
      { key: 'reverseAudio', kind: 'toggle', label: 'Reverse the sound too' },
    ],
  },
  buildOps: (_input, p): Operation[] => [
    { stage: 'filter', op: 'reverse', audio: p.reverseAudio },
    { stage: 'encode', op: 'video', codec: 'h264', crf: 22, preset: 'medium' },
    p.reverseAudio
      ? { stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 128 }
      : { stage: 'stream', op: 'dropAudio' },
    { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
  ],
  estimateOutput: (input) => input.bytes,
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Reverse video online — play it backwards | Editz',
    h1: 'Reverse video',
    description: 'Play a clip backwards, in your browser. Free, no upload, no watermark.',
    intro:
      'Reversing plays every frame in the opposite order, so things un-pour, un-fall and un-jump. It is the one edit that cannot be done a frame at a time — the whole clip has to be held in memory before the last frame can become the first — so keep clips short. A few seconds is usually all a reverse gag needs anyway.',
    steps: [
      'Choose a short clip.',
      'Decide whether the sound should run backwards too.',
      'Press Reverse video and download it.',
    ],
    faq: [
      {
        q: 'Why is there a length limit?',
        a: 'Reversing needs the entire clip in memory at once. Long clips exhaust the browser, so anything sizeable is sent to our servers — the meter tells you before you commit.',
      },
      {
        q: 'Should I reverse the audio?',
        a: 'Reversed speech is unintelligible, so most people leave it off and add music afterwards. Reversed ambient sound can be a nice effect.',
      },
    ],
    related: ['speed-video', 'loop-video', 'cut-video', 'gif-maker'],
    keywords: ['reverse video online', 'play video backwards', 'reverse mp4 free'],
  },
});

const loopParams = z.object({ count: z.number().int().min(2).max(50) });

export const loopVideo = defineTool({
  slug: 'loop-video',
  name: 'Loop video',
  kind: 'video',
  category: 'edit',
  icon: 'repeat-2',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: loopParams,
  defaults: { count: 3 },
  ui: {
    controls: [{ key: 'count', kind: 'number', label: 'Repeat', unit: '×', min: 2, max: 50 }],
  },
  buildOps: (_input, p): Operation[] => [
    { stage: 'input', op: 'loop', count: p.count },
    { stage: 'encode', op: 'video', codec: 'copy' },
    { stage: 'encode', op: 'audio', codec: 'copy' },
    { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
  ],
  estimateOutput: (input, p) => input.bytes * p.count,
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Loop video online — repeat a clip | Editz',
    h1: 'Loop video',
    description: 'Repeat a short clip several times into one longer file. Runs in your browser.',
    intro:
      'Looping writes the same clip out several times in a row as one continuous file. It is useful when a platform will not loop on its own, when you need a background that runs for a set length, or when a short clip needs to fill a slot. Editz copies the video data rather than re-encoding it, so looping is fast and loses nothing — but note that the file gets proportionally bigger each time round.',
    steps: [
      'Choose a short clip.',
      'Set how many times it should repeat.',
      'Press Loop video and download it.',
    ],
    faq: [
      {
        q: 'Does looping reduce the quality?',
        a: 'No. The video data is copied, not re-encoded, so every repeat is identical to the original.',
      },
      {
        q: 'Why is the file so much bigger?',
        a: 'Because it genuinely contains the clip that many times. Looping three times gives you roughly three times the size.',
      },
    ],
    related: ['reverse-video', 'speed-video', 'gif-maker', 'compress-video'],
    keywords: ['loop video online', 'repeat video free', 'make video loop'],
  },
});

const speedParams = z.object({
  factor: z.number().min(0.25).max(4),
  keepAudio: z.boolean(),
});

export const speedVideo = defineTool({
  slug: 'speed-video',
  name: 'Change video speed',
  kind: 'video',
  category: 'edit',
  icon: 'gauge',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: speedParams,
  defaults: { factor: 2, keepAudio: true },
  ui: {
    controls: [
      {
        key: 'factor',
        kind: 'number',
        label: 'Speed',
        unit: '×',
        min: 0.25,
        max: 4,
        step: 0.25,
        hint: 'Under 1 is slow motion',
      },
      { key: 'keepAudio', kind: 'toggle', label: 'Keep audio' },
    ],
  },
  buildOps: (_input, p): Operation[] => {
    const ops: Operation[] = [{ stage: 'filter', op: 'setpts', factor: p.factor }];
    if (p.keepAudio) {
      ops.push({ stage: 'filter', op: 'atempo', factor: p.factor });
      ops.push({ stage: 'encode', op: 'audio', codec: 'aac', bitrateKbps: 128 });
    } else {
      ops.push({ stage: 'stream', op: 'dropAudio' });
    }
    ops.push({ stage: 'encode', op: 'video', codec: 'h264', crf: 22, preset: 'medium' });
    ops.push({ stage: 'container', op: 'format', ext: 'mp4', faststart: true });
    return ops;
  },
  estimateOutput: (input, p) => Math.round(input.bytes / p.factor),
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Change video speed online — speed up or slow down | Editz',
    h1: 'Change video speed',
    description:
      'Speed a video up or slow it down, with the audio pitch left alone. Runs in your browser.',
    intro:
      'Changing speed re-times the video: at 2× every frame is shown for half as long, so the clip finishes in half the time. Above 1× you get a timelapse; below 1× you get slow motion, though the result is only as smooth as the frame rate you shot at — a 30fps clip at quarter speed will judder, because there are no extra frames to show. Audio is re-timed too, with the pitch corrected so voices do not turn into chipmunks.',
    steps: [
      'Choose your video.',
      'Set the speed. Above 1 is faster, below 1 is slower.',
      'Press Change video speed and download it.',
    ],
    faq: [
      {
        q: 'Will the voices sound squeaky?',
        a: 'No. The audio is stretched with pitch correction, so speech stays at its normal pitch and just goes faster or slower.',
      },
      {
        q: 'Why does my slow motion look jerky?',
        a: 'Slowing down shows each existing frame for longer; it cannot invent frames that were never captured. For genuinely smooth slow motion, record at a high frame rate to begin with.',
      },
    ],
    related: ['reverse-video', 'cut-video', 'loop-video', 'compress-video'],
    keywords: ['change video speed online', 'slow motion video free', 'speed up video'],
  },
});

/* -------------------------------------------------------------------------- */
/* Mute / adjust / filter                                                      */
/* -------------------------------------------------------------------------- */

const muteParams = z.object({});

export const muteVideo = defineTool({
  slug: 'mute-video',
  name: 'Mute video',
  kind: 'video',
  category: 'edit',
  icon: 'volume-x',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: muteParams,
  defaults: {},
  // Nothing to configure. A tool with no options is a good sign, not a gap.
  ui: { controls: [] },
  buildOps: (): Operation[] => [
    { stage: 'stream', op: 'dropAudio' },
    // Dropping a stream needs no re-encode at all.
    { stage: 'encode', op: 'video', codec: 'copy' },
    { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
  ],
  estimateOutput: (input) => Math.round(input.bytes * 0.92),
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Mute video online — remove the sound | Editz',
    h1: 'Mute video',
    description:
      'Strip the audio track out of a video. Instant, lossless, and it runs in your browser.',
    intro:
      'Muting removes the audio track from the file entirely rather than turning the volume down. That matters for two reasons: the sound genuinely cannot be recovered by anyone who receives the file, and the video track is left completely untouched, so there is no quality loss and the job takes a second or two regardless of how big the file is. Useful for removing background noise, copyrighted music, or a conversation that was not meant to be recorded.',
    steps: [
      'Choose your video.',
      'There is nothing to configure.',
      'Press Mute video and download the silent file.',
    ],
    faq: [
      {
        q: 'Can the sound be recovered afterwards?',
        a: 'No. The audio track is not written to the new file at all, so it is genuinely gone. Keep your original if you might need it.',
      },
      {
        q: 'Does muting affect the picture?',
        a: 'Not at all. The video data is copied across untouched, which is also why it finishes almost instantly.',
      },
    ],
    related: ['extract-audio', 'add-music-to-video', 'compress-video', 'cut-video'],
    keywords: ['mute video online', 'remove audio from video', 'silence video free'],
  },
});

const adjustParams = z.object({
  brightness: z.number().min(-100).max(100),
  contrast: z.number().min(-100).max(100),
  saturation: z.number().min(-100).max(100),
});

export const adjustVideo = defineTool({
  slug: 'adjust-video',
  name: 'Adjust video',
  kind: 'video',
  category: 'edit',
  icon: 'sliders-horizontal',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: adjustParams,
  defaults: { brightness: 0, contrast: 0, saturation: 0 },
  ui: {
    controls: [
      { key: 'brightness', kind: 'number', label: 'Brightness', min: -100, max: 100, step: 5 },
      { key: 'contrast', kind: 'number', label: 'Contrast', min: -100, max: 100, step: 5 },
      { key: 'saturation', kind: 'number', label: 'Saturation', min: -100, max: 100, step: 5 },
    ],
  },
  buildOps: (_input, p): Operation[] => [
    {
      stage: 'filter',
      op: 'eq',
      // FFmpeg's eq filter takes brightness as -1..1 and the other two as
      // multipliers around 1. The UI works in percentages because nobody
      // thinks in multipliers.
      brightness: p.brightness / 100,
      contrast: 1 + p.contrast / 100,
      saturation: 1 + p.saturation / 100,
    },
    { stage: 'encode', op: 'video', codec: 'h264', crf: 22, preset: 'medium' },
    { stage: 'encode', op: 'audio', codec: 'copy' },
    { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
  ],
  estimateOutput: (input) => input.bytes,
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Adjust video brightness, contrast and saturation | Editz',
    h1: 'Adjust video',
    description:
      'Fix a video that is too dark, too flat or too washed out. Runs in your browser, nothing uploaded.',
    intro:
      'Three controls cover most of what goes wrong with footage. Brightness lifts or lowers everything at once and rescues a clip shot in poor light. Contrast pushes the darks and lights apart, which puts some life back into a flat, grey-looking shot. Saturation controls how strong the colours are — down towards grey, or up for something punchier. Small moves go a long way; large ones tend to look obviously edited.',
    steps: [
      'Choose your video.',
      'Nudge brightness, contrast and saturation.',
      'Press Adjust video and download the result.',
    ],
    faq: [
      {
        q: 'Can this rescue a video shot in the dark?',
        a: 'Partly. Raising brightness reveals what was captured, but it also reveals the noise that comes with it. There is no detail to recover where the sensor recorded nothing at all.',
      },
      {
        q: 'What is the difference between brightness and contrast?',
        a: 'Brightness moves everything up or down together. Contrast spreads the dark and light parts further apart while leaving the midpoint alone.',
      },
    ],
    related: ['filter-video', 'compress-video', 'crop-video', 'video-editor'],
    keywords: ['adjust video brightness', 'video contrast online', 'fix dark video'],
  },
});

const filterParams = z.object({
  preset: z.enum(['none', 'grayscale', 'sepia', 'warm', 'cool', 'vintage', 'high-contrast']),
});

export const filterVideo = defineTool({
  slug: 'filter-video',
  name: 'Add video filter',
  kind: 'video',
  category: 'edit',
  icon: 'wand-2',
  accepts: VIDEO_MIME,
  multiFile: false,
  execution: 'auto',
  params: filterParams,
  defaults: { preset: 'grayscale' },
  ui: {
    controls: [
      {
        key: 'preset',
        kind: 'select',
        label: 'Filter',
        options: [
          { value: 'grayscale', label: 'Black and white' },
          { value: 'sepia', label: 'Sepia' },
          { value: 'warm', label: 'Warm' },
          { value: 'cool', label: 'Cool' },
          { value: 'vintage', label: 'Vintage' },
          { value: 'high-contrast', label: 'High contrast' },
          { value: 'none', label: 'None' },
        ],
      },
    ],
  },
  buildOps: (_input, p): Operation[] => [
    { stage: 'filter', op: 'colorPreset', preset: p.preset },
    { stage: 'encode', op: 'video', codec: 'h264', crf: 22, preset: 'medium' },
    { stage: 'encode', op: 'audio', codec: 'copy' },
    { stage: 'container', op: 'format', ext: 'mp4', faststart: true },
  ],
  estimateOutput: (input) => input.bytes,
  outputExtension: mp4Out,
  copyStatus: 'draft',
  seo: {
    title: 'Add a filter to a video online — free | Editz',
    h1: 'Add video filter',
    description:
      'Apply a colour look to a video — black and white, sepia, warm, cool, vintage. Runs in your browser.',
    intro:
      'A filter applies the same colour treatment to every frame. Black and white removes colour entirely and is a reliable way to make mismatched clips look like they belong together. Sepia and vintage warm and fade the picture towards an older look. Warm and cool shift the whole image towards orange or blue, which is the quickest fix for footage shot under the wrong kind of light. All of it happens on your device.',
    steps: ['Choose your video.', 'Pick a filter.', 'Press Add video filter and download it.'],
    faq: [
      {
        q: 'Can I undo a filter later?',
        a: 'Not from the exported file — the colour change is baked into every frame. Keep your original.',
      },
      {
        q: 'Can I use my own LUT?',
        a: 'Not yet — the filters here are fixed presets. Custom LUT files are planned for the full editor, where colour grading belongs alongside the rest of the timeline.',
      },
    ],
    related: ['adjust-video', 'compress-video', 'meme-maker', 'video-editor'],
    keywords: ['video filter online', 'black and white video', 'vintage video filter free'],
  },
});
