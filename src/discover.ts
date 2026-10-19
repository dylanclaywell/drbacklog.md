// Backlog discovery: find which markdown files in a project actually *are*
// DrBacklog backlogs, so a missing or ambiguous config can be recovered from
// instead of silently creating a second, empty `backlog.md` next to the real one.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { findConfigFile, resolveConfiguredPath } from './config.js';

/** How deep below the project dir to look. Backlogs live at the root or in `docs/`-style dirs. */
const MAX_DEPTH = 2;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);

/**
 * True when `content` looks like a DrBacklog file: a `## Task Details` heading
 * plus at least one task anchor. Fenced code blocks are ignored so docs that
 * merely *show* an example backlog (like this project's README) don't match.
 */
export function looksLikeBacklog(content: string): boolean {
  const unfenced = content.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
  return /^## Task Details\s*$/m.test(unfenced) && /^<a id="task-\d+"><\/a>\s*$/m.test(unfenced);
}

/** Absolute paths of backlog-shaped markdown files under `projectDir`, sorted. */
export function discoverBacklogFiles(projectDir: string): string[] {
  const root = resolve(projectDir);
  const found: string[] = [];

  const walk = (dir: string, depth: number): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        if (depth < MAX_DEPTH && !name.startsWith('.') && !SKIP_DIRS.has(name)) {
          walk(full, depth + 1);
        }
      } else if (
        info.isFile() &&
        name.toLowerCase().endsWith('.md') &&
        info.size <= MAX_FILE_BYTES
      ) {
        try {
          if (looksLikeBacklog(readFileSync(full, 'utf8'))) found.push(full);
        } catch {
          // Unreadable — not a candidate.
        }
      }
    }
  };

  walk(root, 0);
  return found.sort();
}

export type BacklogSource = 'flag' | 'env' | 'config' | 'default' | 'discovered';

export interface BacklogLocation {
  /** The file to use. For an `ambiguous` result this is only the fallback default. */
  path: string;
  source: BacklogSource;
  /** Directory the project config belongs in (where `.drbacklog.json` is or would be written). */
  projectDir: string;
  /**
   * Set when nothing pinned a file and several backlogs exist, so any pick
   * would be a guess. Callers must not read or write until one is chosen.
   */
  ambiguous?: string[];
}

/**
 * Like `resolveBacklogPath`, but when nothing explicit pins the file (no flag,
 * env var or config) it looks at what is actually on disk:
 *   - the conventional `backlog.md` exists            → use it, unless other backlogs exist too (ambiguous)
 *   - no `backlog.md`, exactly one backlog elsewhere   → use that one (discovered)
 *   - no `backlog.md`, several elsewhere               → ambiguous
 *   - nothing                                          → default `backlog.md`, to be created
 */
export function resolveBacklogLocation(
  cwd: string,
  env: NodeJS.ProcessEnv,
  cliFile?: string,
): BacklogLocation {
  const projectDir = resolve(env.CLAUDE_PROJECT_DIR ?? cwd);
  const configPath = findConfigFile(projectDir);
  const configDir = configPath ? dirname(configPath) : projectDir;

  if (cliFile) return { path: resolve(cwd, cliFile), source: 'flag', projectDir: configDir };
  if (env.DRBACKLOG_FILE) {
    return { path: resolve(cwd, env.DRBACKLOG_FILE), source: 'env', projectDir: configDir };
  }
  const configured = resolveConfiguredPath(projectDir);
  if (configured !== null) return { path: configured, source: 'config', projectDir: configDir };

  const defaultPath = resolve(projectDir, 'backlog.md');
  const candidates = discoverBacklogFiles(projectDir);
  if (candidates.length > 1) {
    return { path: defaultPath, source: 'default', projectDir, ambiguous: candidates };
  }
  if (candidates.length === 1 && candidates[0] !== defaultPath) {
    return { path: candidates[0] as string, source: 'discovered', projectDir };
  }
  return { path: defaultPath, source: 'default', projectDir };
}

/** `path` relative to `dir` for display, falling back to the absolute path outside it. */
export function displayPath(dir: string, path: string): string {
  const rel = relative(resolve(dir), resolve(path));
  return rel.length > 0 && !rel.startsWith('..') ? rel : resolve(path);
}
