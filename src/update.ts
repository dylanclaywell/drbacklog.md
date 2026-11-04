// `drbacklog update`: check GitHub Releases for a newer version and, after
// confirmation, install its prebuilt tarball globally with npm.
//
// Releases live only on GitHub (there is no npm registry package), so the flow
// is: ask the GitHub API for the latest release, compare it with the running
// version, download the attached `drbacklog-<version>.tgz`, verify it against
// the SHA-256 digest GitHub records for every release asset, then run
// `npm install -g <tarball>`.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/** GitHub `owner/repo` that publishes releases. */
export const REPO = 'dylanclaywell/drbacklog.md';

const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/**
 * Root of the installed package (the directory holding package.json). This
 * module compiles to `dist/update.js` and runs from `src/update.ts` under tsx;
 * the package root is one level up either way.
 */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The version of the running copy, read from its package.json. */
export function currentVersion(root: string = PACKAGE_ROOT): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof pkg.version !== 'string') throw new Error('package.json has no version');
  return pkg.version;
}

interface ParsedVersion {
  core: [number, number, number];
  pre: string | null;
}

function parseVersion(v: string): ParsedVersion | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

/**
 * Compare two `x.y.z[-pre]` versions: negative when `a < b`, 0 when equal,
 * positive when `a > b`. A prerelease sorts below its release; two prereleases
 * of the same core compare as plain strings, which is enough here.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`Not a version: ${!pa ? a : b}`);
  for (let i = 0; i < 3; i++) {
    const diff = pa.core[i]! - pb.core[i]!;
    if (diff !== 0) return diff;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/**
 * The version a release tag names. release-please tags this repo as
 * `drbacklog-v0.7.0`; a plain `v0.7.0` or `0.7.0` is accepted too.
 */
export function versionFromTag(tag: string): string | null {
  const m = /(?:^|-)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
  return m ? m[1]! : null;
}

export interface ReleaseAsset {
  name: string;
  url: string;
  /** Lowercase hex SHA-256 from GitHub, or null when the API gave none. */
  sha256: string | null;
}

export interface ReleaseInfo {
  version: string;
  tag: string;
  /** Release notes (the release-please changelog section), markdown. */
  notes: string;
  /** The release's web page. */
  htmlUrl: string;
  /** The `drbacklog-<version>.tgz` asset, or null when it wasn't attached. */
  tarball: ReleaseAsset | null;
}

/** Pull what the updater needs out of a GitHub "get a release" response. */
export function parseRelease(json: unknown): ReleaseInfo {
  const r = json as {
    tag_name?: unknown;
    body?: unknown;
    html_url?: unknown;
    assets?: unknown;
  };
  if (typeof r?.tag_name !== 'string') throw new Error('Release response has no tag_name');
  const version = versionFromTag(r.tag_name);
  if (!version) throw new Error(`Can't read a version from release tag "${r.tag_name}"`);

  const wanted = `drbacklog-${version}.tgz`;
  const assets = Array.isArray(r.assets) ? (r.assets as Record<string, unknown>[]) : [];
  const asset = assets.find((a) => a.name === wanted);
  let tarball: ReleaseAsset | null = null;
  if (asset && typeof asset.browser_download_url === 'string') {
    const digest = typeof asset.digest === 'string' ? asset.digest : '';
    const m = /^sha256:([0-9a-f]{64})$/i.exec(digest);
    tarball = {
      name: wanted,
      url: asset.browser_download_url,
      sha256: m ? m[1]!.toLowerCase() : null,
    };
  }

  return {
    version,
    tag: r.tag_name,
    notes: typeof r.body === 'string' ? r.body : '',
    htmlUrl: typeof r.html_url === 'string' ? r.html_url : `https://github.com/${REPO}/releases`,
    tarball,
  };
}

/** Ask GitHub for the latest (non-draft, non-prerelease) release. */
export async function fetchLatestRelease(fetchImpl: typeof fetch = fetch): Promise<ReleaseInfo> {
  const res = await fetchImpl(LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'drbacklog-updater',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status} ${res.statusText} for ${LATEST_RELEASE_URL}`);
  }
  return parseRelease(await res.json());
}

/**
 * How this copy was installed:
 * - `source`: a git checkout (Option A, or `npm link` of one). Updating means
 *   `git pull && npm run build`; a global npm install would only shadow it.
 * - `global`: under npm's global `node_modules` (Option B). Safe to reinstall.
 * - `other`: anything else (e.g. a project dependency) — we don't touch it.
 */
export type InstallKind = 'source' | 'global' | 'other';

export function detectInstall(root: string, npmGlobalRoot: string | null): InstallKind {
  if (existsSync(join(root, '.git'))) return 'source';
  if (npmGlobalRoot && isInside(root, npmGlobalRoot)) return 'global';
  return 'other';
}

function isInside(child: string, parent: string): boolean {
  // Resolve symlinks on both sides: version managers like fnm and nvm report
  // `npm root -g` through a symlinked directory, while this module's own path
  // (from import.meta.url) is already the real one.
  const norm = (p: string): string => {
    let r = resolve(p);
    try {
      r = realpathSync(r);
    } catch {
      // Doesn't exist — compare the plain resolved path.
    }
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const rel = relative(norm(parent), norm(child));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

const IS_WINDOWS = process.platform === 'win32';

/**
 * Spawn npm. On Windows npm is `npm.cmd`, which Node only runs through a
 * shell, so there the command is passed as one string (an args array with
 * `shell: true` is deprecated, and gets joined unescaped anyway). Every arg is
 * double-quoted: Windows paths can't contain `"`, and the args here are fixed
 * flags plus a temp-dir path, which may contain spaces.
 */
function spawnNpm(args: string[]): ReturnType<typeof spawn> {
  return IS_WINDOWS
    ? spawn(['npm', ...args.map((a) => `"${a}"`)].join(' '), { stdio: 'inherit', shell: true })
    : spawn('npm', args, { stdio: 'inherit' });
}

/** `npm root -g`, or null when npm can't be run. */
export function npmGlobalRoot(): string | null {
  const out = IS_WINDOWS
    ? spawnSync('npm root -g', { encoding: 'utf8', shell: true, timeout: 15_000 })
    : spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 15_000 });
  if (out.status !== 0 || typeof out.stdout !== 'string') return null;
  const path = out.stdout.trim();
  return path.length > 0 ? path : null;
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Download the tarball and check it against GitHub's recorded digest. */
export async function downloadVerified(
  asset: ReleaseAsset,
  fetchImpl: typeof fetch,
): Promise<{ dir: string; file: string }> {
  if (!asset.sha256) {
    throw new Error(
      `GitHub reported no SHA-256 digest for ${asset.name}, so it can't be verified. ` +
        `Download it from the release page and install it by hand if you trust it.`,
    );
  }
  const res = await fetchImpl(asset.url, {
    headers: { 'User-Agent': 'drbacklog-updater' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const data = Buffer.from(await res.arrayBuffer());
  const actual = sha256Hex(data);
  if (actual !== asset.sha256) {
    throw new Error(
      `Checksum mismatch for ${asset.name}: expected ${asset.sha256}, got ${actual}. Not installing.`,
    );
  }
  const dir = await mkdtemp(join(tmpdir(), 'drbacklog-update-'));
  const file = join(dir, asset.name);
  await writeFile(file, data);
  return { dir, file };
}

function npmInstallGlobal(tarballPath: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawnNpm(['install', '-g', tarballPath]);
    child.on('error', reject);
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

/** Trim release notes for the terminal: drop blank runs and cap the length. */
export function summarizeNotes(notes: string, maxLines = 30): string {
  const lines = notes
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line, i, all) => line.trim() !== '' || (all[i - 1] ?? '').trim() !== '');
  if (lines.length <= maxLines) return lines.join('\n').trim();
  return [...lines.slice(0, maxLines), `… (${lines.length - maxLines} more lines)`].join('\n');
}

export interface UpdateOptions {
  /** Only report whether an update exists; never install. */
  check: boolean;
  /** Install without asking. */
  yes: boolean;
}

export function parseUpdateArgs(argv: readonly string[]): UpdateOptions | { error: string } {
  const opts: UpdateOptions = { check: false, yes: false };
  for (const arg of argv) {
    if (arg === '--check') opts.check = true;
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else return { error: `Unknown option for update: ${arg}` };
  }
  return opts;
}

const USAGE = 'Usage: drbacklog update [--check] [--yes]';

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Entry point for `drbacklog update`. Returns the process exit code. All
 * output goes to the terminal; this never runs inside the MCP server.
 */
export async function runUpdateCommand(argv: readonly string[]): Promise<number> {
  const opts = parseUpdateArgs(argv);
  if ('error' in opts) {
    console.error(`${opts.error}\n${USAGE}`);
    return 2;
  }

  const installed = currentVersion();
  let latest: ReleaseInfo;
  try {
    latest = await fetchLatestRelease();
  } catch (err) {
    console.error(`Couldn't check for updates: ${(err as Error).message}`);
    return 1;
  }

  if (compareVersions(latest.version, installed) <= 0) {
    console.log(`drbacklog ${installed} is up to date.`);
    return 0;
  }

  console.log(`drbacklog ${latest.version} is available (you have ${installed}).`);
  const notes = summarizeNotes(latest.notes);
  if (notes) console.log(`\n${notes}\n`);
  console.log(`Release: ${latest.htmlUrl}`);

  // `--check` signals "update available" with exit code 1, so scripts can
  // test for it; the plain command treats a successful run as 0.
  if (opts.check) return 1;

  const kind = detectInstall(PACKAGE_ROOT, npmGlobalRoot());
  if (kind === 'source') {
    console.log(
      `\nThis copy runs from a git checkout (${PACKAGE_ROOT}). Update it with:\n` +
        `  git pull && npm install && npm run build`,
    );
    return 0;
  }
  if (kind === 'other') {
    console.log(
      `\nThis copy (${PACKAGE_ROOT}) isn't a global npm install, so it won't be replaced ` +
        `automatically. Install the release tarball wherever you manage drbacklog.`,
    );
    return 0;
  }

  if (!latest.tarball) {
    console.error(`\nThe release has no drbacklog-${latest.version}.tgz attached.`);
    return 1;
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      console.error('\nNot a terminal, so not asking. Re-run with --yes to install.');
      return 1;
    }
    if (!(await confirm(`\nInstall drbacklog ${latest.version} globally with npm? [y/N] `))) {
      console.log('Not updated.');
      return 0;
    }
  }

  let download: { dir: string; file: string };
  try {
    download = await downloadVerified(latest.tarball, fetch);
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }

  try {
    console.log(`Verified ${latest.tarball.name} (sha256 ${latest.tarball.sha256}). Installing…`);
    const code = await npmInstallGlobal(download.file);
    if (code !== 0) {
      console.error(`npm exited with code ${code}; drbacklog was not updated.`);
      return code;
    }
  } finally {
    await rm(download.dir, { recursive: true, force: true });
  }

  console.log(
    `\nUpdated to drbacklog ${latest.version}. Restart Claude Code (or its MCP server) ` +
      `to pick up the new version.`,
  );
  return 0;
}
