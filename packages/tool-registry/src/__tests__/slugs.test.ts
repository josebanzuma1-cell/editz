import { describe, expect, it } from 'vitest';
import { allSlugs } from '../index';
import { TOOL_SLUGS } from '../slugs';

describe('the lightweight slug list', () => {
  it('matches the registry exactly, in the same order', () => {
    // If this fails, a tool was added or renamed without updating slugs.ts.
    // Copy the array from the failure output — the duplication is deliberate
    // (it keeps the middleware bundle small) but it is not allowed to drift.
    expect([...TOOL_SLUGS]).toEqual(allSlugs());
  });
});
