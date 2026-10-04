import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverBacklogFiles, looksLikeBacklog, resolveBacklogLocation } from './discover.js';

const BACKLOG =
  '# B\n\n## TODO\n\n---\n\n## Task Details\n\n<a id="task-1"></a>\n\n### #1: T\n\n- **Status:** TODO\n';

describe('looksLikeBacklog', () => {
  it('matches a real backlog', () => expect(looksLikeBacklog(BACKLOG)).toBe(true));
  it('ignores an example inside a code fence', () => {
    expect(looksLikeBacklog('# Docs\n\n```markdown\n' + BACKLOG + '```\n')).toBe(false);
  });
  it('ignores ordinary markdown', () => expect(looksLikeBacklog('# Hi\n')).toBe(false));
});

describe('resolveBacklogLocation', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drbacklog-disc-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('defaults to backlog.md when nothing exists', () => {
    const loc = resolveBacklogLocation(dir, {});
    expect(loc).toMatchObject({ source: 'default', path: join(dir, 'backlog.md') });
    expect(loc.ambiguous).toBeUndefined();
  });

  it('discovers a lone backlog outside the default location', async () => {
    await mkdir(join(dir, 'docs'));
    await writeFile(join(dir, 'docs', 'plan.md'), BACKLOG);
    expect(resolveBacklogLocation(dir, {})).toMatchObject({
      source: 'discovered',
      path: join(dir, 'docs', 'plan.md'),
    });
  });

  it('is ambiguous when several backlogs exist and none is configured', async () => {
    await mkdir(join(dir, 'docs'));
    await writeFile(join(dir, 'backlog.md'), BACKLOG);
    await writeFile(join(dir, 'docs', 'backlog.md'), BACKLOG);
    expect(resolveBacklogLocation(dir, {}).ambiguous).toHaveLength(2);
  });

  it('a config file resolves the ambiguity', async () => {
    await mkdir(join(dir, 'docs'));
    await writeFile(join(dir, 'backlog.md'), BACKLOG);
    await writeFile(join(dir, 'docs', 'backlog.md'), BACKLOG);
    await writeFile(join(dir, '.drbacklog.json'), '{"file":"docs/backlog.md"}');
    const loc = resolveBacklogLocation(dir, {});
    expect(loc).toMatchObject({ source: 'config', path: join(dir, 'docs', 'backlog.md') });
    expect(loc.ambiguous).toBeUndefined();
  });

  it('skips node_modules', async () => {
    await mkdir(join(dir, 'node_modules'));
    await writeFile(join(dir, 'node_modules', 'x.md'), BACKLOG);
    expect(discoverBacklogFiles(dir)).toEqual([]);
  });
});
