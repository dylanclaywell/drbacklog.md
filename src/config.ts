// Per-project config: `.drbacklog.json` at the project root, recording which
// file holds the backlog.
//
// This exists because the path can otherwise only be pinned with an env var,
// which lives in whichever process it was set for — an MCP server pointed at
// `docs/backlog.md` through DRBACKLOG_FILE is invisible to a TUI launched from
// a shell. A committed config file is seen by both, by teammates, and by CI,
// and because it's found by walking *up* from the working directory, the TUI
// resolves the right backlog when launched from any subdirectory.

import { readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Name of the per-project config file. */
export const CONFIG_FILENAME = '.drbacklog.json';

/**
 * The config file's shape. Deliberately minimal — unknown keys are preserved
 * on write and ignored on read, so this can grow without breaking older
 * versions, and it does not become a general settings file.
 */
export interface DrBacklogConfig {
  /** Backlog file, relative to the config file's own directory (or absolute). */
  file?: string;
}

/**
 * Walk up from `startDir` looking for a config file, returning its path or
 * null at the filesystem root.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not here — keep walking.
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // hit the root
    dir = parent;
  }
}

/**
 * Read and parse a config file. Returns null when it is missing, unreadable,
 * malformed JSON, or not a JSON object: a broken config falls back to the
 * default resolution rather than making the tool unusable.
 */
export function readConfigFile(path: string): DrBacklogConfig | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed;
}

/**
 * The backlog path configured for the project containing `startDir`, or null
 * if there's no config file or it doesn't name one. A relative `file` resolves
 * against the config file's directory — not the cwd — so the config stays
 * valid wherever the command is run from.
 */
export function resolveConfiguredPath(startDir: string): string | null {
  const configPath = findConfigFile(startDir);
  if (configPath === null) return null;
  const config = readConfigFile(configPath);
  if (typeof config?.file !== 'string' || config.file.trim().length === 0) return null;
  return resolve(dirname(configPath), config.file.trim());
}

/**
 * Record `backlogPath` in `dir`'s config file, creating it or updating just
 * the `file` key of an existing one (other keys, and anyone's hand edits to
 * them, survive). Returns the config file's path.
 *
 * The stored path is relative with forward slashes whenever the backlog lives
 * under `dir`, so the config is portable across machines and checkouts; an
 * absolute path is stored only when a relative one can't be expressed (a
 * different drive on Windows).
 */
export async function writeConfiguredPath(dir: string, backlogPath: string): Promise<string> {
  const configPath = join(resolve(dir), CONFIG_FILENAME);
  const existing = readConfigFile(configPath) ?? {};
  const next: DrBacklogConfig = { ...existing, file: relativizeForConfig(dir, backlogPath) };

  await mkdir(resolve(dir), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return configPath;
}

/** `backlogPath` as it should be stored in a config file living in `dir`. */
export function relativizeForConfig(dir: string, backlogPath: string): string {
  const rel = relative(resolve(dir), resolve(backlogPath));
  // `relative` gives back an absolute path when there's no relative route at
  // all (different Windows drives); an empty string means the paths are equal,
  // which can't name a file.
  if (rel.length === 0 || isAbsolute(rel)) return resolve(backlogPath);
  return sep === '/' ? rel : rel.split(sep).join('/');
}
