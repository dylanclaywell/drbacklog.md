// Passive "a newer version exists" check for the TUI. At most one GitHub API
// call per day (the result is cached in ~/.drbacklog/), never installs
// anything, and never throws: being offline or rate-limited just means no
// notice. Installing is `drbacklog update`'s job.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { compareVersions, currentVersion, fetchLatestRelease } from './update.js';

/** How long a check result is reused before asking GitHub again. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateCheckCache {
  /** Epoch ms of the last attempt, successful or not. */
  checkedAt: number;
  /** Latest release version seen, or null if no check has succeeded yet. */
  latestVersion: string | null;
}

export function defaultCachePath(home: string = homedir()): string {
  return join(home, '.drbacklog', 'update-check.json');
}

/** Opt out with DRBACKLOG_NO_UPDATE_CHECK=1; also off in CI. */
export function updateChecksDisabled(env: NodeJS.ProcessEnv): boolean {
  const optOut = env.DRBACKLOG_NO_UPDATE_CHECK;
  if (optOut !== undefined && optOut !== '' && optOut !== '0' && optOut !== 'false') return true;
  return env.CI !== undefined && env.CI !== '' && env.CI !== 'false';
}

async function readCache(path: string): Promise<UpdateCheckCache | null> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<UpdateCheckCache>;
    if (typeof raw.checkedAt !== 'number') return null;
    return {
      checkedAt: raw.checkedAt,
      latestVersion: typeof raw.latestVersion === 'string' ? raw.latestVersion : null,
    };
  } catch {
    return null;
  }
}

async function writeCache(path: string, cache: UpdateCheckCache): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(cache) + '\n', 'utf8');
  } catch {
    // A read-only home just means checking more often.
  }
}

export interface CheckOptions {
  installed?: string;
  now?: number;
  cachePath?: string;
  fetchImpl?: typeof fetch;
}

/**
 * The newer version available, or null when up to date, recently checked
 * with nothing new, or the check failed.
 */
export async function checkForUpdate(opts: CheckOptions = {}): Promise<string | null> {
  try {
    const installed = opts.installed ?? currentVersion();
    const now = opts.now ?? Date.now();
    const cachePath = opts.cachePath ?? defaultCachePath();

    const cached = await readCache(cachePath);
    let latest = cached?.latestVersion ?? null;
    // A cache stamped in the future (clock change) counts as stale.
    const fresh = cached && now >= cached.checkedAt && now - cached.checkedAt < CHECK_INTERVAL_MS;
    if (!fresh) {
      try {
        latest = (await fetchLatestRelease(opts.fetchImpl)).version;
      } catch {
        // Keep the last known version; the stamp below still backs off a day.
      }
      await writeCache(cachePath, { checkedAt: now, latestVersion: latest });
    }

    return latest && compareVersions(latest, installed) > 0 ? latest : null;
  } catch {
    return null;
  }
}
