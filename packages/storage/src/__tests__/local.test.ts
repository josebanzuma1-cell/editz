import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '../local';
import { inputKey, outputKey, sanitise } from '../types';

const root = mkdtempSync(join(tmpdir(), 'editz-storage-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let storage: LocalStorage;

beforeEach(() => {
  storage = new LocalStorage({
    root,
    secret: 'test-secret',
    publicOrigin: 'http://localhost:3000',
  });
});

describe('keys', () => {
  it('puts a job’s files under one prefix, so a sweep is one delete', () => {
    expect(inputKey('abc', 'holiday.mp4')).toBe('jobs/abc/in/holiday.mp4');
    expect(outputKey('abc', 'out.mp4')).toBe('jobs/abc/out/out.mp4');
  });

  it('strips anything that could escape the prefix', () => {
    expect(sanitise('../../etc/passwd')).not.toContain('..');
    expect(sanitise('../../etc/passwd')).not.toContain('/');
  });

  it('keeps a readable name out of an unreadable one', () => {
    // Runs collapse: an emoji is two UTF-16 units, so without that this comes
    // back as `holiday____video.mp4`.
    expect(sanitise('holiday 🎉 video.mp4')).toBe('holiday_video.mp4');
  });

  it('never returns an empty key', () => {
    expect(sanitise('...')).toBeTruthy();
    expect(sanitise('')).toBe('file');
  });
});

describe('signing', () => {
  it('accepts a signature it just produced', async () => {
    const { url } = await storage.presignPut('jobs/1/in/a.mp4');
    const params = new URL(url).searchParams;
    expect(
      storage.verify('jobs/1/in/a.mp4', 'PUT', Number(params.get('exp')), params.get('sig')!),
    ).toBe(true);
  });

  it('refuses a signature for a different key', async () => {
    // Otherwise one upload URL is an upload URL for the whole bucket.
    const { url } = await storage.presignPut('jobs/1/in/a.mp4');
    const params = new URL(url).searchParams;
    expect(
      storage.verify('jobs/2/in/b.mp4', 'PUT', Number(params.get('exp')), params.get('sig')!),
    ).toBe(false);
  });

  it('refuses a PUT signature used for a GET', async () => {
    const { url } = await storage.presignPut('jobs/1/in/a.mp4');
    const params = new URL(url).searchParams;
    expect(
      storage.verify('jobs/1/in/a.mp4', 'GET', Number(params.get('exp')), params.get('sig')!),
    ).toBe(false);
  });

  it('refuses an expired signature', async () => {
    const { url } = await storage.presignGet('jobs/1/out/a.mp4', { expiresInSeconds: -1 });
    const params = new URL(url).searchParams;
    expect(
      storage.verify('jobs/1/out/a.mp4', 'GET', Number(params.get('exp')), params.get('sig')!),
    ).toBe(false);
  });

  it('refuses a stretched expiry, which is the obvious thing to try', async () => {
    const { url } = await storage.presignGet('jobs/1/out/a.mp4');
    const params = new URL(url).searchParams;
    const later = Number(params.get('exp')) + 86_400_000;
    expect(storage.verify('jobs/1/out/a.mp4', 'GET', later, params.get('sig')!)).toBe(false);
  });

  it('refuses a malformed signature instead of throwing', async () => {
    expect(storage.verify('jobs/1/in/a.mp4', 'PUT', Date.now() + 1000, 'nonsense')).toBe(false);
    expect(storage.verify('jobs/1/in/a.mp4', 'PUT', Number.NaN, '')).toBe(false);
  });

  it('binds the size cap into the signature', async () => {
    // A cap that is not signed is a suggestion.
    const { url } = await storage.presignPut('jobs/1/in/a.mp4', { maxBytes: 1000 });
    const params = new URL(url).searchParams;
    const exp = Number(params.get('exp'));
    expect(storage.verify('jobs/1/in/a.mp4', 'PUT', exp, params.get('sig')!, 1000)).toBe(true);
    expect(storage.verify('jobs/1/in/a.mp4', 'PUT', exp, params.get('sig')!, 999_999)).toBe(false);
  });

  it('gives uploads minutes and downloads an hour', async () => {
    const put = await storage.presignPut('k');
    const get = await storage.presignGet('k');
    expect(put.expiresAt.getTime()).toBeLessThan(get.expiresAt.getTime());
  });
});

describe('objects', () => {
  it('round-trips a file and reports its size', async () => {
    await storage.put('jobs/1/in/a.mp4', new Uint8Array([1, 2, 3, 4]), 'video/mp4');
    const head = await storage.head('jobs/1/in/a.mp4');
    expect(head).toEqual({ bytes: 4, contentType: 'video/mp4' });
  });

  it('reports nothing for an object that is not there', async () => {
    expect(await storage.head('jobs/nope/in/a.mp4')).toBeNull();
  });

  it('reads only the first bytes, so a 2GB file costs 16 to identify', async () => {
    const body = new Uint8Array(4096).fill(7);
    body.set([0xff, 0xd8, 0xff], 0);
    await storage.put('jobs/1/in/big.bin', body);
    const head = await storage.readHead('jobs/1/in/big.bin', 16);
    expect(head).toHaveLength(16);
    expect([...head.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('moves files to and from local scratch, which is what the worker does', async () => {
    const scratch = join(root, 'scratch', 'out.mp4');
    await writeFile(join(root, 'source.mp4'), Buffer.from('encoded'));
    await storage.uploadFrom('jobs/1/out/o.mp4', join(root, 'source.mp4'), 'video/mp4');
    await storage.downloadTo('jobs/1/out/o.mp4', scratch);
    expect(await readFile(scratch, 'utf8')).toBe('encoded');
  });

  it('deletes on request, so "delete now" does not mean "wait a day"', async () => {
    await storage.put('jobs/1/in/gone.mp4', new Uint8Array([1]));
    await storage.delete('jobs/1/in/gone.mp4');
    expect(await storage.head('jobs/1/in/gone.mp4')).toBeNull();
  });

  it('deleting something already gone is not an error', async () => {
    await expect(storage.delete('jobs/1/in/never.mp4')).resolves.toBeUndefined();
  });

  it('refuses a key that climbs out of the root', async () => {
    // Keys are generated by us, so this should be unreachable — which is
    // exactly why it is asserted. A traversal that only opens up after a
    // refactor is the kind that ships.
    await expect(storage.put('../escaped.txt', new Uint8Array([1]))).rejects.toThrow(/escapes/);
    await expect(storage.head('../../etc/passwd')).resolves.toBeNull();
  });
});
