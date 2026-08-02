import type { AnyToolManifest, ToolCategory } from './types';
import * as tools from './tools';

export * from './types';
export * from './tools';

/**
 * The registry.
 *
 * Everything downstream — routes, the tools index, navigation, the sitemap,
 * OG images, the landing pages themselves — reads from here. Adding a tool
 * means adding a manifest and exporting it; nothing else in the app changes.
 * The order below is the order tools appear wherever they are listed.
 */
export const TOOLS: readonly AnyToolManifest[] = [
  // Video edit
  tools.compressVideo,
  tools.resizeVideo,
  tools.cropVideo,
  tools.cutVideo,
  tools.splitVideo,
  tools.mergeVideo,
  tools.rotateVideo,
  tools.flipVideo,
  tools.reverseVideo,
  tools.loopVideo,
  tools.speedVideo,
  tools.muteVideo,
  tools.adjustVideo,
  tools.filterVideo,

  // Create
  tools.videoEditor,
  tools.slideshowMaker,
  tools.memeMaker,
  tools.gifMaker,
  tools.stopMotion,

  // Audio
  tools.cutAudio,
  tools.mergeAudio,
  tools.addMusicToVideo,
  tools.extractAudio,
  tools.audioRecorder,

  // Image
  tools.resizeImage,
  tools.cropImage,
  tools.compressImage,
  tools.convertImage,
  tools.dpiConverter,

  // Convert
  tools.videoConverter,
  tools.audioConverter,
  tools.imageConverter,

  // AI
  tools.autoSubtitles,
  tools.addSubtitles,
  tools.videoTranslator,
  tools.audioTranslator,
  tools.textToSpeech,

  // Record
  tools.screenRecorder,
  tools.cameraRecorder,
  tools.presentationRecorder,
];

const BY_SLUG = new Map<string, AnyToolManifest>(TOOLS.map((t) => [t.slug, t]));

export function getTool(slug: string): AnyToolManifest | undefined {
  return BY_SLUG.get(slug);
}

export function allSlugs(): string[] {
  return TOOLS.map((t) => t.slug);
}

export function toolsByCategory(category: ToolCategory): AnyToolManifest[] {
  return TOOLS.filter((t) => t.category === category);
}

export function relatedTools(slug: string): AnyToolManifest[] {
  const tool = getTool(slug);
  if (!tool) return [];
  return tool.seo.related
    .map((s) => BY_SLUG.get(s))
    .filter((t): t is AnyToolManifest => t !== undefined);
}

/** Display order and labels for the tools index. Categories live here rather
 *  than in each manifest so the index page has no opinion of its own. */
export const CATEGORY_ORDER: readonly ToolCategory[] = [
  'edit',
  'create',
  'audio',
  'image',
  'convert',
  'ai',
  'record',
];

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  edit: 'Edit video',
  create: 'Create',
  audio: 'Audio',
  image: 'Images',
  convert: 'Convert',
  ai: 'Subtitles and translation',
  record: 'Record',
};
