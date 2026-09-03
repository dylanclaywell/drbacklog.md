// Storage layer: read/write backlog.md on disk with safe concurrency.
//
// Writes are atomic (temp file + rename) so a crash mid-write can never leave a
// truncated backlog. Mutations run through a serial lock so overlapping MCP
// tool calls can't clobber each other with lost read-modify-write updates.

import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { resolveConfiguredPath } from './config.js';
import { parse } from './parse.js';
import { render } from './render.js';
import { isLegacyFormat, migrateContent } from './migrate.js';
import { DEFAULT_TITLE } from './model.js';
import type { BacklogDocument } from './model.js';

/**
 * Thrown by `load`/`mutate` when the file is in the pre-rename format and the
 * caller has not opted into migrating it (see `LoadOptions.migrate`).
 */
export class LegacyFormatError extends Error {
  constructor() {
    super(
      'backlog.md is in the old pre-rename format (CRITICAL/STABLE/ARCHIVED ' +
        'headings, "Admitted" field) and must be migrated before this can run.',
    );
    this.name = 'LegacyFormatError';
  }
}

export interface LoadOptions {
  /**
   * When the file is in the pre-rename format: if true, migrate it in place
   * before reading; if false/omitted, throw LegacyFormatError instead of
   * reading it.
   */
  migrate?: boolean;
}

/** A fresh, empty backlog with the default title and no tasks. */
export function createEmptyDocument(): BacklogDocument {
  return {
    title: DEFAULT_TITLE,
    tasks: [],
    epics: [],
    passthrough: { preamble: [], midNotes: [] },
  };
}

/**
 * Resolve the backlog file path. Precedence:
 *   1. --file <path>   — explicit override for this run (relative to cwd)
 *   2. DRBACKLOG_FILE  — explicit override (absolute, or relative to cwd)
 *   3. .drbacklog.json — nearest project config walking up from the project
 *      dir (see config.ts); its `file` is relative to the config file itself
 *   4. CLAUDE_PROJECT_DIR/backlog.md — per-project default when Claude Code
 *      spawns the server (cwd is not a reliable project root; this env var is)
 *   5. cwd/backlog.md  — last-resort fallback
 */
export function resolveBacklogPath(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  cliFile?: string,
): string {
  if (cliFile) return resolve(cwd, cliFile);
  if (env.DRBACKLOG_FILE) return resolve(cwd, env.DRBACKLOG_FILE);

  const projectDir = env.CLAUDE_PROJECT_DIR ?? cwd;
  const configured = resolveConfiguredPath(projectDir);
  if (configured !== null) return configured;

  return resolve(projectDir, 'backlog.md');
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** Thrown when the backlog cannot be written after exhausting retries. */
export class BacklogWriteError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BacklogWriteError';
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// On Windows, rename-over-existing can transiently fail with EPERM/EACCES when
// the destination is briefly locked (antivirus, search indexer, a just-closed
// handle), especially under rapid successive writes. These clear within
// milliseconds, so retry with a short backoff before giving up.
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EEXIST']);

async function renameWithRetry(from: string, to: string, attempts = 10): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!TRANSIENT_RENAME_CODES.has(code)) throw err;
      if (i >= attempts - 1) {
        throw new BacklogWriteError(
          `Could not write ${to}: still locked after ${attempts} attempts (${code}). ` +
            `Another process may be holding the file — close it and try again.`,
          { cause: err },
        );
      }
      await delay(Math.min(100, 2 ** i));
    }
  }
}

export class BacklogStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /**
   * Read and parse the backlog, or an empty document if the file is absent.
   * Throws LegacyFormatError if the file is pre-rename format and
   * `options.migrate` isn't true; when it is true, the file is rewritten to
   * the current format in place (under the same lock as any mutation) before
   * being parsed.
   */
  async load(options: LoadOptions = {}): Promise<BacklogDocument> {
    return this.runExclusive(() => this.loadLocked(options));
  }

  /** `load`'s body, assuming the caller already holds the exclusive lock. */
  private async loadLocked(options: LoadOptions): Promise<BacklogDocument> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (err) {
      if (isNotFound(err)) return createEmptyDocument();
      throw err;
    }

    if (isLegacyFormat(raw)) {
      if (!options.migrate) throw new LegacyFormatError();
      raw = migrateContent(raw);
      await this.writeText(raw);
    }

    return parse(raw);
  }

  /** Atomically write a document to disk (temp file + rename). */
  async save(doc: BacklogDocument): Promise<void> {
    await this.writeText(render(doc));
  }

  /** Atomically write raw text to disk (temp file + rename). */
  private async writeText(text: string): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const tmp = join(dir, `.${basename(this.filePath)}.${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, text, 'utf8');
      await renameWithRetry(tmp, this.filePath);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Run a read-modify-write mutation under an exclusive lock. The mutator
   * receives the current document, mutates it in place, and may return a
   * result value; the updated document is then saved atomically. See `load`
   * for `options.migrate`.
   */
  async mutate<T>(
    mutator: (doc: BacklogDocument) => T | Promise<T>,
    options: LoadOptions = {},
  ): Promise<T> {
    return this.runExclusive(async () => {
      const doc = await this.loadLocked(options);
      const result = await mutator(doc);
      await this.save(doc);
      return result;
    });
  }

  /** Create the backlog file with boilerplate if it does not already exist. */
  async ensureInitialized(): Promise<void> {
    await this.runExclusive(async () => {
      try {
        await access(this.filePath);
      } catch (err) {
        if (isNotFound(err)) await this.save(createEmptyDocument());
        else throw err;
      }
    });
  }

  /** Chain a task after any in-flight mutation so writes never interleave. */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    // Keep the chain alive even if this task rejects; the caller still sees the
    // rejection via the returned promise.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
