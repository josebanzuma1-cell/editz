import type { z } from 'zod';
import type {
  ExecutionMode,
  MediaInput,
  MediaKind,
  Operation,
  ServerReason,
} from '@editz/engine-core';

export type { ExecutionMode, MediaInput, MediaKind, Operation, ServerReason };

export type ToolCategory = 'edit' | 'convert' | 'create' | 'audio' | 'image' | 'ai' | 'record';

/* -------------------------------------------------------------------------- */
/* Declarative parameter UI                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A manifest owns its controls as data, not as a component.
 *
 * The alternative — deriving controls by introspecting the Zod schema — sounds
 * tidier but has nowhere to put a label, a unit, an ordering, or "only show the
 * target-size box when the mode is target-size". Deriving from `_def` is also
 * a standing invitation for a Zod minor release to break every tool page at
 * once. So: the schema validates, this describes. Both live in the manifest,
 * and a test asserts every control key exists in the schema.
 *
 * `showIf` is a pure predicate so it can run on the server during SSR and in
 * the browser on change, with the same result.
 */
export interface ParamOption {
  /** Always a string, because that is what a DOM control gives back. Controls
   *  whose parameter is numeric set `valueType: 'number'` and the panel
   *  coerces before validating. */
  value: string;
  label: string;
  /** One short clause. Shown under the option, not in a tooltip. */
  hint?: string;
}

interface ParamControlBase<P> {
  key: keyof P & string;
  label: string;
  hint?: string;
  showIf?: (params: P) => boolean;
}

export type ParamControl<P> =
  | (ParamControlBase<P> & { kind: 'segmented'; options: ParamOption[]; valueType?: 'number' })
  | (ParamControlBase<P> & { kind: 'select'; options: ParamOption[]; valueType?: 'number' })
  | (ParamControlBase<P> & {
      kind: 'number';
      min: number;
      max: number;
      step?: number;
      unit?: string;
    })
  | (ParamControlBase<P> & { kind: 'toggle' })
  | (ParamControlBase<P> & { kind: 'text'; placeholder?: string; maxLength?: number })
  | (ParamControlBase<P> & { kind: 'time'; hintFromDuration?: boolean });

/* -------------------------------------------------------------------------- */
/* SEO                                                                         */
/* -------------------------------------------------------------------------- */

export interface ToolSeo {
  title: string;
  h1: string;
  /** Meta description. Keep at or under 160 characters. */
  description: string;
  /**
   * 150+ words, specific to this tool. Templated boilerplate with the tool name
   * swapped in is worse than nothing — Google detects it and it is also just
   * bad writing. Blank lines separate paragraphs.
   */
  intro: string;
  /** Rendered as a HowTo block with structured data. */
  steps: [string, string, string];
  faq: { q: string; a: string }[];
  /** Slugs. A test asserts each one resolves to a real tool. */
  related: string[];
  keywords?: string[];
}

/* -------------------------------------------------------------------------- */
/* The manifest                                                                */
/* -------------------------------------------------------------------------- */

export interface ToolManifest<S extends z.ZodType = z.ZodType> {
  /** URL segment. The route is `/${slug}`, generated — never hand-written. */
  slug: string;
  name: string;
  kind: MediaKind;
  category: ToolCategory;
  /** lucide-react icon name. */
  icon: string;
  /** Accepted MIME types. The client filters with these; the server re-checks
   *  the real type by magic bytes and does not trust them (§11). */
  accepts: string[];
  multiFile: boolean;

  execution: ExecutionMode;
  serverOnly?: boolean;
  /**
   * Pure. Lets a *parameter choice* force the server without making
   * `decideExecution` impure or tool-aware.
   */
  requiresServer?: (input: MediaInput, params: z.infer<S>) => ServerReason | null;
  /** Per-tool override of the global wasm ceiling. */
  clientCeilingBytes?: number;

  params: S;
  defaults: z.infer<S>;
  ui: {
    controls: ParamControl<z.infer<S>>[];
    /**
     * `tool` — the standard shell: drop a file, set parameters, get a result.
     * `app`  — the tool *is* an application (the multi-track editor, the
     *          recorders). The landing page keeps its SEO copy but sends you
     *          into the app instead of rendering a parameter panel.
     */
    surface?: 'tool' | 'app';
  };

  /**
   * The whole point. Engine-agnostic; compiled to argv by engine-core.
   *
   * `inputs` is the full list for `multiFile` tools (merge, slideshow). Single
   * -file tools ignore it, which is why it is third and optional rather than
   * every manifest having to unwrap a one-element array.
   */
  buildOps: (
    input: MediaInput,
    params: z.infer<S>,
    inputs?: readonly MediaInput[],
  ) => Operation[];
  /** Bytes, or null when we genuinely cannot tell. Drives the data meter's
   *  "about 12 MB" readout before any work starts. */
  estimateOutput?: (input: MediaInput, params: z.infer<S>) => number | null;
  /** Container extension of the result, for the download filename. Takes the
   *  input too, since "keep the original format" is a legitimate choice. */
  outputExtension: (params: z.infer<S>, input: MediaInput) => string;

  seo: ToolSeo;

  /** Set while the SEO copy is still below the 150-word floor. `pnpm copy:audit`
   *  lists these; launch checklist is that the list is empty. */
  copyStatus?: 'draft' | 'final';
}

/**
 * The registry is heterogeneous, so the schema generic has to be erased at the
 * boundary and re-narrowed inside a tool's own module. Every consumer that only
 * reads slugs, copy and categories works fine against this.
 */
// An existential type. `ToolManifest<z.ZodType>` would make `defaults` and
// `buildOps` unusable across a heterogeneous collection, and there is no
// narrower encoding for this in TypeScript today.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolManifest = ToolManifest<any>;

/** Helper that keeps `defaults`, `ui.controls` and `buildOps` inferred against
 *  the schema instead of being widened to `unknown` at the declaration site. */
export function defineTool<S extends z.ZodType>(manifest: ToolManifest<S>): ToolManifest<S> {
  return manifest;
}
