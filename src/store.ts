// Storage layer: read/write backlog.md on disk with safe concurrency.
//
// Writes are atomic (temp file + rename) so a crash mid-write can never leave a
// truncated backlog. Mutations run through a serial lock so overlapping MCP
// tool calls can't clobber each other with lost read-modify-write updates.

import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { parse } from './parse.js';
import { render } from './render.js';
import { DEFAULT_TITLE } from './model.js';
import type { BacklogDocument } from './model.js';

/** A fresh, empty backlog with the default title and no tasks. */
export function createEmptyDocument(): BacklogDocument {
  return { title: DEFAULT_TITLE, tasks: [], passthrough: { preamble: [], midNotes: [] } };
}

/**
 * Resolve the backlog file path. Precedence:
 *   1. DRBACKLOG_FILE  — explicit override (absolute, or relative to cwd)
 *   2. CLAUDE_PROJECT_DIR/backlog.md — per-project default when Claude Code
 *      spawns the server (cwd is not a reliable project root; this env var is)
 *   3. cwd/backlog.md  — last-resort fallback
 */
export function resolveBacklogPath(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.DRBACKLOG_FILE) return resolve(cwd, env.DRBACKLOG_FILE);
  return resolve(env.CLAUDE_PROJECT_DIR ?? cwd, 'backlog.md');
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

export class BacklogStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /** Read and parse the backlog, or an empty document if the file is absent. */
  async load(): Promise<BacklogDocument> {
    try {
      return parse(await readFile(this.filePath, 'utf8'));
    } catch (err) {
      if (isNotFound(err)) return createEmptyDocument();
      throw err;
    }
  }

  /** Atomically write a document to disk (temp file + rename). */
  async save(doc: BacklogDocument): Promise<void> {
    const text = render(doc);
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const tmp = join(dir, `.${basename(this.filePath)}.${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, this.filePath);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Run a read-modify-write mutation under an exclusive lock. The mutator
   * receives the current document, mutates it in place, and may return a
   * result value; the updated document is then saved atomically.
   */
  async mutate<T>(mutator: (doc: BacklogDocument) => T | Promise<T>): Promise<T> {
    return this.runExclusive(async () => {
      const doc = await this.load();
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
