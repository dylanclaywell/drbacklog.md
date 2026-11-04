import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CHECK_INTERVAL_MS, checkForUpdate, updateChecksDisabled } from './update-check.js';

function fakeFetch(version: string | null): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  const impl = (() => {
    calls++;
    if (version === null) return Promise.reject(new Error('offline'));
    return Promise.resolve(
      new Response(JSON.stringify({ tag_name: `drbacklog-v${version}`, assets: [] }), {
        status: 200,
      }),
    );
  }) as unknown as typeof fetch;
  return { fetch: impl, calls: () => calls };
}

describe('checkForUpdate', () => {
  let dir: string;
  let cachePath: string;
  const NOW = 1_800_000_000_000;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drbacklog-update-check-'));
    cachePath = join(dir, 'nested', 'update-check.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports a newer release and caches the result', async () => {
    const f = fakeFetch('0.8.0');
    const result = await checkForUpdate({
      installed: '0.7.0',
      now: NOW,
      cachePath,
      fetchImpl: f.fetch,
    });
    expect(result).toBe('0.8.0');
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual({
      checkedAt: NOW,
      latestVersion: '0.8.0',
    });
  });

  it('returns null when up to date', async () => {
    const f = fakeFetch('0.7.0');
    expect(
      await checkForUpdate({ installed: '0.7.0', now: NOW, cachePath, fetchImpl: f.fetch }),
    ).toBeNull();
  });

  it('uses a fresh cache without calling GitHub', async () => {
    const path = join(dir, 'update-check.json');
    await writeFile(path, JSON.stringify({ checkedAt: NOW - 1000, latestVersion: '0.9.0' }));
    const f = fakeFetch('1.0.0');
    const result = await checkForUpdate({
      installed: '0.7.0',
      now: NOW,
      cachePath: path,
      fetchImpl: f.fetch,
    });
    expect(result).toBe('0.9.0');
    expect(f.calls()).toBe(0);
  });

  it('checks again once the cache is a day old', async () => {
    const path = join(dir, 'update-check.json');
    await writeFile(
      path,
      JSON.stringify({ checkedAt: NOW - CHECK_INTERVAL_MS, latestVersion: '0.7.0' }),
    );
    const f = fakeFetch('0.8.0');
    expect(
      await checkForUpdate({ installed: '0.7.0', now: NOW, cachePath: path, fetchImpl: f.fetch }),
    ).toBe('0.8.0');
    expect(f.calls()).toBe(1);
  });

  it('treats a cache from the future as stale', async () => {
    const path = join(dir, 'update-check.json');
    await writeFile(path, JSON.stringify({ checkedAt: NOW + 60_000, latestVersion: '0.7.0' }));
    const f = fakeFetch('0.8.0');
    await checkForUpdate({ installed: '0.7.0', now: NOW, cachePath: path, fetchImpl: f.fetch });
    expect(f.calls()).toBe(1);
  });

  it('stays quiet when offline, but backs off and keeps the last known version', async () => {
    const path = join(dir, 'update-check.json');
    await writeFile(
      path,
      JSON.stringify({ checkedAt: NOW - CHECK_INTERVAL_MS * 2, latestVersion: '0.8.0' }),
    );
    const f = fakeFetch(null);
    expect(
      await checkForUpdate({ installed: '0.7.0', now: NOW, cachePath: path, fetchImpl: f.fetch }),
    ).toBe('0.8.0');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      checkedAt: NOW,
      latestVersion: '0.8.0',
    });
  });

  it('ignores a corrupt cache', async () => {
    const path = join(dir, 'update-check.json');
    await writeFile(path, 'not json');
    const f = fakeFetch('0.8.0');
    expect(
      await checkForUpdate({ installed: '0.7.0', now: NOW, cachePath: path, fetchImpl: f.fetch }),
    ).toBe('0.8.0');
  });
});

describe('updateChecksDisabled', () => {
  it('is on by default', () => {
    expect(updateChecksDisabled({})).toBe(false);
  });

  it('honours the opt-out variable', () => {
    expect(updateChecksDisabled({ DRBACKLOG_NO_UPDATE_CHECK: '1' })).toBe(true);
    expect(updateChecksDisabled({ DRBACKLOG_NO_UPDATE_CHECK: '0' })).toBe(false);
  });

  it('is off in CI', () => {
    expect(updateChecksDisabled({ CI: 'true' })).toBe(true);
    expect(updateChecksDisabled({ CI: 'false' })).toBe(false);
  });
});
