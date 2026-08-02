import { describe, expect, it } from 'vitest';
import type { MediaInput } from '@editz/engine-core';
import { CATEGORY_LABELS, CATEGORY_ORDER, TOOLS, getTool } from '../index';

/** A plausible probed input per kind, so `buildOps` gets what it would really
 *  be handed rather than an empty object. */
const SAMPLE: Record<string, MediaInput> = {
  video: {
    name: 'clip.mp4',
    bytes: 48 * 1024 * 1024,
    mime: 'video/mp4',
    kind: 'video',
    durationSec: 92,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
  },
  audio: {
    name: 'note.mp3',
    bytes: 4 * 1024 * 1024,
    mime: 'audio/mpeg',
    kind: 'audio',
    durationSec: 180,
    hasAudio: true,
  },
  image: {
    name: 'photo.jpg',
    bytes: 3 * 1024 * 1024,
    mime: 'image/jpeg',
    kind: 'image',
    width: 4032,
    height: 3024,
  },
};

const sampleFor = (kind: string): MediaInput => SAMPLE[kind] ?? SAMPLE.video!;

describe('registry', () => {
  it('has tools in it', () => {
    expect(TOOLS.length).toBeGreaterThan(30);
  });

  it('has no duplicate slugs', () => {
    const slugs = TOOLS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('has url-safe slugs', () => {
    for (const tool of TOOLS) {
      expect(tool.slug, tool.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('lists every category in CATEGORY_ORDER, with a label', () => {
    for (const tool of TOOLS) {
      expect(CATEGORY_ORDER, tool.slug).toContain(tool.category);
      expect(CATEGORY_LABELS[tool.category]).toBeTruthy();
    }
  });

  it('has no unreachable tools — every one is findable by slug', () => {
    for (const tool of TOOLS) {
      expect(getTool(tool.slug)).toBe(tool);
    }
  });
});

describe('every manifest', () => {
  for (const tool of TOOLS) {
    describe(tool.slug, () => {
      it('has defaults that satisfy its own schema', () => {
        const result = tool.params.safeParse(tool.defaults);
        expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
      });

      it('only declares controls for keys the schema actually has', () => {
        // `defaults` alone is not the full key set: an optional parameter
        // (compress-video's target size) legitimately has no default. Take the
        // union of the schema shape and the defaults.
        const shape = (tool.params as { shape?: Record<string, unknown> }).shape;
        const keys = new Set([
          ...Object.keys(tool.defaults as Record<string, unknown>),
          ...(shape ? Object.keys(shape) : []),
        ]);
        for (const control of tool.ui.controls) {
          expect(keys, `${tool.slug}.${control.key}`).toContain(control.key);
        }
      });

      it('does not declare the same control twice', () => {
        const keys = tool.ui.controls.map((c) => c.key);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it('builds operations from its defaults without throwing', () => {
        const input = sampleFor(tool.kind);
        expect(() => tool.buildOps(input, tool.defaults, [input])).not.toThrow();
        expect(Array.isArray(tool.buildOps(input, tool.defaults, [input]))).toBe(true);
      });

      it('names a file extension for its output', () => {
        const ext = tool.outputExtension(tool.defaults, sampleFor(tool.kind));
        expect(ext, tool.slug).toMatch(/^[a-z0-9]{2,5}$/);
      });

      it('estimates an output size that is a positive number, or admits it cannot', () => {
        if (!tool.estimateOutput) return;
        const estimate = tool.estimateOutput(sampleFor(tool.kind), tool.defaults);
        if (estimate !== null) {
          expect(estimate).toBeGreaterThan(0);
          expect(Number.isFinite(estimate)).toBe(true);
        }
      });

      it('does not claim to be both client-only and server-only', () => {
        if (tool.serverOnly) expect(tool.execution).not.toBe('client');
      });

      it('accepts something, unless it captures its own input', () => {
        // Recorders capture from a device and text-to-speech is typed in, so
        // an empty `accepts` is correct for those and a mistake anywhere else.
        const capturesOwnInput = tool.ui.surface === 'app' || tool.slug === 'text-to-speech';
        if (!capturesOwnInput) expect(tool.accepts.length, tool.slug).toBeGreaterThan(0);
      });
    });
  }
});

describe('SEO copy', () => {
  for (const tool of TOOLS) {
    describe(tool.slug, () => {
      it('has a title, an h1 and a description', () => {
        expect(tool.seo.title.length).toBeGreaterThan(10);
        expect(tool.seo.h1.length).toBeGreaterThan(2);
        expect(tool.seo.description.length).toBeGreaterThan(40);
      });

      it('keeps the meta description under 160 characters', () => {
        expect(tool.seo.description.length, tool.seo.description).toBeLessThanOrEqual(160);
      });

      it('has exactly three how-to steps', () => {
        expect(tool.seo.steps).toHaveLength(3);
        for (const step of tool.seo.steps) expect(step.length).toBeGreaterThan(10);
      });

      it('has at least two FAQ entries, each a real answer', () => {
        expect(tool.seo.faq.length).toBeGreaterThanOrEqual(2);
        for (const entry of tool.seo.faq) {
          expect(entry.q.endsWith('?'), entry.q).toBe(true);
          expect(entry.a.length, entry.q).toBeGreaterThan(60);
        }
      });

      it('links only to tools that exist', () => {
        for (const slug of tool.seo.related) {
          expect(getTool(slug), `${tool.slug} → ${slug}`).toBeDefined();
        }
      });

      it('does not link to itself', () => {
        expect(tool.seo.related).not.toContain(tool.slug);
      });

      it('links to at least three related tools', () => {
        // Internal linking is most of what makes a long tail of landing pages
        // work at all. Fewer than three and the page is an island.
        expect(tool.seo.related.length, tool.slug).toBeGreaterThanOrEqual(3);
      });
    });
  }

  it('has a unique title and h1 for every tool', () => {
    const titles = TOOLS.map((t) => t.seo.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('has a unique intro for every tool — no templated boilerplate', () => {
    const intros = TOOLS.map((t) => t.seo.intro);
    expect(new Set(intros).size).toBe(intros.length);
  });
});
