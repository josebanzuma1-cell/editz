import type { AnyToolManifest, ToolCategory } from '@editz/tool-registry/types';

/**
 * Loads a single tool's manifest into the browser.
 *
 * A manifest is not data — it holds a Zod schema, `buildOps`, `estimateOutput`,
 * `requiresServer` and the `showIf` predicates on its controls. None of that
 * survives being serialised from a server component, and none of it should be:
 * the client genuinely needs the code.
 *
 * So the server component passes a slug and the browser imports the module.
 * Importing the whole registry instead would put forty tools' worth of SEO copy
 * into the bundle of every tool page, which is precisely the §9 budget this is
 * meant to protect. One dynamic import per category keeps a tool page carrying
 * its own category and nothing else.
 *
 * When a tool's copy gets its full pass and moves into its own file, only the
 * map below changes — no call site does.
 */

const MODULES = {
  video: () => import('@editz/tool-registry/tools/video'),
  create: () => import('@editz/tool-registry/tools/create'),
  audio: () => import('@editz/tool-registry/tools/audio'),
  image: () => import('@editz/tool-registry/tools/image'),
  convert: () => import('@editz/tool-registry/tools/convert'),
  ai: () => import('@editz/tool-registry/tools/ai'),
  record: () => import('@editz/tool-registry/tools/record'),
} as const;

type ModuleName = keyof typeof MODULES;

/** Categories and directories line up except for `edit`, which lives in the
 *  video directory — the category is what the tool does, the directory is what
 *  it does it to. */
const MODULE_BY_CATEGORY: Record<ToolCategory, ModuleName> = {
  edit: 'video',
  create: 'create',
  audio: 'audio',
  image: 'image',
  convert: 'convert',
  ai: 'ai',
  record: 'record',
};

function isManifest(value: unknown): value is AnyToolManifest {
  return typeof value === 'object' && value !== null && 'slug' in value && 'buildOps' in value;
}

export async function loadTool(slug: string, category: ToolCategory): Promise<AnyToolManifest> {
  const loaded = await MODULES[MODULE_BY_CATEGORY[category]]();

  for (const exported of Object.values(loaded)) {
    if (isManifest(exported) && exported.slug === slug) return exported;
  }

  // Loudly, rather than rendering an empty panel: this can only happen if a
  // manifest moved module without the map being updated.
  throw new Error(`Tool "${slug}" is not exported from the "${category}" module.`);
}
