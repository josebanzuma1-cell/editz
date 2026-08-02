import { describe, expect, it } from 'vitest';
import { TOOLS } from '../index';

/**
 * The copy audit.
 *
 * §9 sets a floor of 150 words of tool-specific intro copy per landing page.
 * Pages still under it are marked `copyStatus: 'draft'` and listed here rather
 * than failing the build — the fill-in pass is tracked, not forgotten. A page
 * marked `final` that is under the floor *does* fail, so nothing can be quietly
 * declared done while it is still thin.
 *
 * Run it on its own with `pnpm copy:audit`.
 */

const FLOOR = 150;

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

describe('landing page copy', () => {
  it('meets the 150-word floor on every page marked final', () => {
    const short = TOOLS.filter((t) => t.copyStatus === 'final' && wordCount(t.seo.intro) < FLOOR).map(
      (t) => `${t.slug} (${wordCount(t.seo.intro)} words)`,
    );
    expect(short, `marked final but under ${FLOOR} words`).toEqual([]);
  });

  it('reports what is still outstanding', () => {
    const drafts = TOOLS.filter((t) => wordCount(t.seo.intro) < FLOOR).sort(
      (a, b) => wordCount(a.seo.intro) - wordCount(b.seo.intro),
    );

    const done = TOOLS.length - drafts.length;
    const lines = [
      '',
      `  Copy audit — ${done}/${TOOLS.length} landing pages at or above ${FLOOR} words.`,
      '',
      ...drafts.map((t) => `    ${String(wordCount(t.seo.intro)).padStart(3)}w  ${t.slug}`),
      '',
    ];
    // This test exists to print a report; the console call is the point.
    console.log(lines.join('\n'));

    // Every page below the floor must at least be honestly labelled.
    for (const tool of drafts) {
      expect(tool.copyStatus, `${tool.slug} is under the floor but not marked draft`).toBe('draft');
    }
  });
});
