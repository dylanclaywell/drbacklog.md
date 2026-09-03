import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import { resolveDraftPath } from './setup.js';

const BASE = resolve('/projects/demo');

describe('resolveDraftPath', () => {
  it('resolves a bare name against the base directory', () => {
    expect(resolveDraftPath('sprint.md', BASE)).toBe(resolve(BASE, 'sprint.md'));
  });

  it('appends .md when the name has no extension', () => {
    expect(resolveDraftPath('sprint', BASE)).toBe(resolve(BASE, 'sprint.md'));
  });

  it('leaves an existing extension alone', () => {
    expect(resolveDraftPath('notes.markdown', BASE)).toBe(resolve(BASE, 'notes.markdown'));
  });

  it('keeps absolute paths absolute', () => {
    const abs = resolve('/elsewhere/backlog.md');
    expect(resolveDraftPath(abs, BASE)).toBe(abs);
  });

  it('resolves nested relative paths', () => {
    expect(resolveDraftPath('docs/backlog.md', BASE)).toBe(resolve(BASE, 'docs/backlog.md'));
  });

  it('trims surrounding whitespace', () => {
    expect(resolveDraftPath('  sprint.md  ', BASE)).toBe(resolve(BASE, 'sprint.md'));
  });

  it('returns null for an empty draft', () => {
    expect(resolveDraftPath('   ', BASE)).toBeNull();
  });
});
