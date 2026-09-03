import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  CONFIG_FILENAME,
  findConfigFile,
  readConfigFile,
  relativizeForConfig,
  resolveConfiguredPath,
  writeConfiguredPath,
} from './config.js';
import { parseFileArg } from './cli.js';
import { resolveBacklogPath } from './store.js';

describe('config file', () => {
  let dir: string;

  beforeEach(async () => {
    // realpath-ish: macOS tmpdir is a symlink, so compare resolved paths only.
    dir = await mkdtemp(join(tmpdir(), 'drbacklog-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = (at: string, body: string): Promise<void> =>
    writeFile(join(at, CONFIG_FILENAME), body, 'utf8');

  describe('findConfigFile', () => {
    it('finds a config in the starting directory', async () => {
      await write(dir, '{}');
      expect(findConfigFile(dir)).toBe(join(dir, CONFIG_FILENAME));
    });

    it('walks up to a parent directory', async () => {
      await write(dir, '{}');
      const nested = join(dir, 'a', 'b', 'c');
      await mkdir(nested, { recursive: true });
      expect(findConfigFile(nested)).toBe(join(dir, CONFIG_FILENAME));
    });

    it('prefers the nearest config when several are nested', async () => {
      await write(dir, '{}');
      const inner = join(dir, 'inner');
      await mkdir(inner, { recursive: true });
      await write(inner, '{}');
      expect(findConfigFile(inner)).toBe(join(inner, CONFIG_FILENAME));
    });

    it('returns null when there is no config anywhere above', async () => {
      const nested = join(dir, 'deep');
      await mkdir(nested, { recursive: true });
      expect(findConfigFile(nested)).toBeNull();
    });
  });

  describe('readConfigFile', () => {
    it('returns null for a missing file', () => {
      expect(readConfigFile(join(dir, 'nope.json'))).toBeNull();
    });

    it('returns null for malformed JSON rather than throwing', async () => {
      await write(dir, '{ not json');
      expect(readConfigFile(join(dir, CONFIG_FILENAME))).toBeNull();
    });

    it('returns null for JSON that is not an object', async () => {
      await write(dir, '["backlog.md"]');
      expect(readConfigFile(join(dir, CONFIG_FILENAME))).toBeNull();
    });
  });

  describe('resolveConfiguredPath', () => {
    it('resolves `file` relative to the config file, not the start dir', async () => {
      await write(dir, JSON.stringify({ file: 'docs/backlog.md' }));
      const nested = join(dir, 'src', 'deep');
      await mkdir(nested, { recursive: true });
      expect(resolveConfiguredPath(nested)).toBe(resolve(dir, 'docs/backlog.md'));
    });

    it('honors an absolute `file`', async () => {
      const abs = resolve(dir, 'elsewhere', 'backlog.md');
      await write(dir, JSON.stringify({ file: abs }));
      expect(resolveConfiguredPath(dir)).toBe(abs);
    });

    it('returns null when the config has no usable `file`', async () => {
      await write(dir, JSON.stringify({ file: '   ' }));
      expect(resolveConfiguredPath(dir)).toBeNull();
    });

    it('returns null when there is no config', () => {
      expect(resolveConfiguredPath(dir)).toBeNull();
    });
  });

  describe('writeConfiguredPath', () => {
    it('stores a relative, forward-slashed path', async () => {
      await writeConfiguredPath(dir, join(dir, 'docs', 'backlog.md'));
      const written = JSON.parse(await readFile(join(dir, CONFIG_FILENAME), 'utf8')) as {
        file: string;
      };
      expect(written.file).toBe('docs/backlog.md');
    });

    it('round-trips through resolveConfiguredPath', async () => {
      const target = join(dir, 'docs', 'backlog.md');
      await writeConfiguredPath(dir, target);
      expect(resolveConfiguredPath(dir)).toBe(resolve(target));
    });

    it('preserves unknown keys already in the file', async () => {
      await write(dir, JSON.stringify({ file: 'old.md', somethingElse: 42 }));
      await writeConfiguredPath(dir, join(dir, 'new.md'));
      const written = JSON.parse(await readFile(join(dir, CONFIG_FILENAME), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(written).toEqual({ file: 'new.md', somethingElse: 42 });
    });
  });

  describe('relativizeForConfig', () => {
    it('keeps a path outside the directory relative', () => {
      expect(relativizeForConfig(join(dir, 'sub'), join(dir, 'backlog.md'))).toBe('../backlog.md');
    });
  });

  describe('resolveBacklogPath precedence', () => {
    it('prefers --file over everything else', async () => {
      await write(dir, JSON.stringify({ file: 'from-config.md' }));
      const path = resolveBacklogPath(dir, { DRBACKLOG_FILE: 'from-env.md' }, 'from-cli.md');
      expect(path).toBe(resolve(dir, 'from-cli.md'));
    });

    it('prefers DRBACKLOG_FILE over the config file', async () => {
      await write(dir, JSON.stringify({ file: 'from-config.md' }));
      expect(resolveBacklogPath(dir, { DRBACKLOG_FILE: 'from-env.md' })).toBe(
        resolve(dir, 'from-env.md'),
      );
    });

    it('uses the config file when no override is set', async () => {
      await write(dir, JSON.stringify({ file: 'docs/backlog.md' }));
      expect(resolveBacklogPath(dir, {})).toBe(resolve(dir, 'docs/backlog.md'));
    });

    it('searches from CLAUDE_PROJECT_DIR, not the cwd', async () => {
      await write(dir, JSON.stringify({ file: 'docs/backlog.md' }));
      const elsewhere = await mkdtemp(join(tmpdir(), 'drbacklog-cwd-'));
      try {
        expect(resolveBacklogPath(elsewhere, { CLAUDE_PROJECT_DIR: dir })).toBe(
          resolve(dir, 'docs/backlog.md'),
        );
      } finally {
        await rm(elsewhere, { recursive: true, force: true });
      }
    });

    it('falls back to the default when a config exists but names no file', async () => {
      await write(dir, JSON.stringify({ somethingElse: true }));
      expect(resolveBacklogPath(dir, {})).toBe(resolve(dir, 'backlog.md'));
    });
  });
});

describe('parseFileArg', () => {
  it('reads --file <path>', () => {
    expect(parseFileArg(['--file', 'docs/backlog.md'])).toBe('docs/backlog.md');
  });

  it('reads --file=<path>', () => {
    expect(parseFileArg(['--file=docs/backlog.md'])).toBe('docs/backlog.md');
  });

  it('returns undefined when the flag is absent', () => {
    expect(parseFileArg(['--other', 'x'])).toBeUndefined();
  });

  it('ignores a --file with no value', () => {
    expect(parseFileArg(['--file'])).toBeUndefined();
    expect(parseFileArg(['--file', '--other'])).toBeUndefined();
    expect(parseFileArg(['--file='])).toBeUndefined();
  });
});
