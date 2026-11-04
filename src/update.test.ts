import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareVersions,
  currentVersion,
  detectInstall,
  downloadVerified,
  fetchLatestRelease,
  parseRelease,
  parseUpdateArgs,
  summarizeNotes,
  versionFromTag,
} from './update.js';

const DIGEST = 'ab'.repeat(32);

function releaseJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'drbacklog-v0.8.0',
    html_url: 'https://github.com/dylanclaywell/drbacklog.md/releases/tag/drbacklog-v0.8.0',
    body: '## 0.8.0\n\n### Features\n\n* something',
    assets: [
      {
        name: 'drbacklog-0.8.0.tgz',
        browser_download_url:
          'https://github.com/dylanclaywell/drbacklog.md/releases/download/drbacklog-v0.8.0/drbacklog-0.8.0.tgz',
        digest: `sha256:${DIGEST}`,
      },
    ],
    ...overrides,
  };
}

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('0.8.0', '0.7.0')).toBeGreaterThan(0);
    expect(compareVersions('0.7.0', '0.7.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.7.0', '0.7.0')).toBe(0);
  });

  it('sorts a prerelease below its release', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
  });

  it('rejects things that are not versions', () => {
    expect(() => compareVersions('latest', '1.0.0')).toThrow();
  });
});

describe('versionFromTag', () => {
  it('reads release-please component tags', () => {
    expect(versionFromTag('drbacklog-v0.7.0')).toBe('0.7.0');
  });

  it('reads plain tags', () => {
    expect(versionFromTag('v1.2.3')).toBe('1.2.3');
    expect(versionFromTag('1.2.3')).toBe('1.2.3');
  });

  it('returns null for tags without a version', () => {
    expect(versionFromTag('nightly')).toBeNull();
  });
});

describe('parseRelease', () => {
  it('extracts version, notes, and the tarball with its digest', () => {
    const r = parseRelease(releaseJson());
    expect(r.version).toBe('0.8.0');
    expect(r.tag).toBe('drbacklog-v0.8.0');
    expect(r.notes).toContain('Features');
    expect(r.tarball?.name).toBe('drbacklog-0.8.0.tgz');
    expect(r.tarball?.url).toMatch(/\/drbacklog-v0\.8\.0\/drbacklog-0\.8\.0\.tgz$/);
    expect(r.tarball?.sha256).toBe(DIGEST);
  });

  it('ignores tarballs for other versions', () => {
    const r = parseRelease(
      releaseJson({
        assets: [{ name: 'drbacklog-0.7.0.tgz', browser_download_url: 'x', digest: '' }],
      }),
    );
    expect(r.tarball).toBeNull();
  });

  it('leaves sha256 null when GitHub gives no digest', () => {
    const r = parseRelease(
      releaseJson({
        assets: [{ name: 'drbacklog-0.8.0.tgz', browser_download_url: 'x', digest: null }],
      }),
    );
    expect(r.tarball?.sha256).toBeNull();
  });

  it('throws on a response without a usable tag', () => {
    expect(() => parseRelease({})).toThrow(/tag_name/);
    expect(() => parseRelease({ tag_name: 'nightly' })).toThrow(/version/);
  });
});

describe('fetchLatestRelease', () => {
  it('requests the latest release and parses it', async () => {
    let requested = '';
    const fakeFetch = ((url: string) => {
      requested = url;
      return Promise.resolve(new Response(JSON.stringify(releaseJson()), { status: 200 }));
    }) as unknown as typeof fetch;
    const r = await fetchLatestRelease(fakeFetch);
    expect(requested).toBe(
      'https://api.github.com/repos/dylanclaywell/drbacklog.md/releases/latest',
    );
    expect(r.version).toBe('0.8.0');
  });

  it('throws on an HTTP error', async () => {
    const fakeFetch = (() =>
      Promise.resolve(
        new Response('rate limited', { status: 403, statusText: 'Forbidden' }),
      )) as unknown as typeof fetch;
    await expect(fetchLatestRelease(fakeFetch)).rejects.toThrow(/403/);
  });
});

describe('detectInstall', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drbacklog-update-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('treats a git checkout as a source install', async () => {
    await mkdir(join(dir, '.git'));
    expect(detectInstall(dir, null)).toBe('source');
  });

  it('treats a package under the npm global root as global', async () => {
    const globalRoot = join(dir, 'npm', 'node_modules');
    const pkg = join(globalRoot, 'drbacklog');
    await mkdir(pkg, { recursive: true });
    expect(detectInstall(pkg, globalRoot)).toBe('global');
  });

  it('sees through a symlinked global root (fnm, nvm)', async () => {
    // npm reports the global root through the version manager's symlink,
    // while the package's own path is the real one.
    const realRoot = join(dir, 'versions', 'v24', 'node_modules');
    const pkg = join(realRoot, 'drbacklog');
    await mkdir(pkg, { recursive: true });
    const linkedRoot = join(dir, 'shell-link');
    await symlink(realRoot, linkedRoot, 'junction');
    expect(detectInstall(await realpath(pkg), linkedRoot)).toBe('global');
  });

  it('treats anything else as other', async () => {
    const pkg = join(dir, 'project', 'node_modules', 'drbacklog');
    await mkdir(pkg, { recursive: true });
    expect(detectInstall(pkg, join(dir, 'npm', 'node_modules'))).toBe('other');
    expect(detectInstall(pkg, null)).toBe('other');
  });
});

describe('currentVersion', () => {
  it('reads the version from package.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'drbacklog-update-'));
    try {
      await writeFile(join(dir, 'package.json'), '{"version":"1.2.3"}');
      expect(currentVersion(dir)).toBe('1.2.3');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads the real package version by default', () => {
    expect(versionFromTag(currentVersion())).not.toBeNull();
  });
});

describe('parseUpdateArgs', () => {
  it('parses flags', () => {
    expect(parseUpdateArgs([])).toEqual({ check: false, yes: false });
    expect(parseUpdateArgs(['--check'])).toEqual({ check: true, yes: false });
    expect(parseUpdateArgs(['-y'])).toEqual({ check: false, yes: true });
  });

  it('rejects unknown flags', () => {
    const result = parseUpdateArgs(['--force']);
    expect('error' in result && result.error).toContain('--force');
  });
});

describe('summarizeNotes', () => {
  it('collapses blank-line runs', () => {
    expect(summarizeNotes('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('caps the length', () => {
    const notes = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const out = summarizeNotes(notes, 10).split('\n');
    expect(out).toHaveLength(11);
    expect(out[10]).toContain('40 more lines');
  });
});

describe('downloadVerified', () => {
  const body = Buffer.from('pretend tarball');
  const goodHash = createHash('sha256').update(body).digest('hex');
  const serve = (() =>
    Promise.resolve(new Response(body, { status: 200 }))) as unknown as typeof fetch;
  const asset = (sha256: string | null) => ({ name: 'drbacklog-0.8.0.tgz', url: 'x', sha256 });

  it('writes the file when the digest matches', async () => {
    const { dir, file } = await downloadVerified(asset(goodHash), serve);
    try {
      expect(await readFile(file)).toEqual(body);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a download whose digest does not match', async () => {
    await expect(downloadVerified(asset('0'.repeat(64)), serve)).rejects.toThrow(
      /Checksum mismatch/,
    );
  });

  it('refuses when GitHub gave no digest, without downloading', async () => {
    let fetched = false;
    const spy = (() => {
      fetched = true;
      return Promise.resolve(new Response(body));
    }) as unknown as typeof fetch;
    await expect(downloadVerified(asset(null), spy)).rejects.toThrow(/no SHA-256/);
    expect(fetched).toBe(false);
  });

  it('refuses a failed download', async () => {
    const notFound = (() =>
      Promise.resolve(new Response('nope', { status: 404 }))) as unknown as typeof fetch;
    await expect(downloadVerified(asset(goodHash), notFound)).rejects.toThrow(/404/);
  });
});
