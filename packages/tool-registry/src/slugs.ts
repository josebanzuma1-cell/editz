/**
 * Just the slugs, as a plain array.
 *
 * This exists so the Next.js middleware can decide whether a request is for a
 * tool route without pulling the whole registry — Zod, every `buildOps`
 * function and roughly a hundred kilobytes of SEO copy — into the edge bundle.
 * Middleware runs on every request; it should not be carrying the FAQ for
 * `dpi-converter` around.
 *
 * It is duplication, so it is guarded: `slugs.test.ts` fails if this list and
 * `TOOLS` ever disagree.
 */
export const TOOL_SLUGS: readonly string[] = [
  'compress-video',
  'resize-video',
  'crop-video',
  'cut-video',
  'split-video',
  'merge-video',
  'rotate-video',
  'flip-video',
  'reverse-video',
  'loop-video',
  'speed-video',
  'mute-video',
  'adjust-video',
  'filter-video',
  'video-editor',
  'slideshow-maker',
  'meme-maker',
  'gif-maker',
  'stop-motion',
  'cut-audio',
  'merge-audio',
  'add-music-to-video',
  'extract-audio',
  'audio-recorder',
  'resize-image',
  'crop-image',
  'compress-image',
  'convert-image',
  'dpi-converter',
  'video-converter',
  'audio-converter',
  'image-converter',
  'auto-subtitle-generator',
  'add-subtitles',
  'video-translator',
  'audio-translator',
  'text-to-speech',
  'screen-recorder',
  'camera-recorder',
  'presentation-recorder',
];
