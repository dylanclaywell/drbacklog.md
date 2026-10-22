// Tests for code highlighting: which tokens get which role, and that the
// result stays line-for-line with the source so wrapping can work on it.

import { describe, expect, it } from 'vitest';

import { highlightCode } from './highlight.js';
import { lineText } from './markdown.js';

const roleOf = (rows: ReturnType<typeof highlightCode>, text: string) =>
  rows.flat().find((span) => span.text === text)?.syntax;

describe('highlightCode', () => {
  it('marks keywords, literals and comments', () => {
    const rows = highlightCode('const n = 42; // answer\nreturn "hi";', 'ts');
    expect(roleOf(rows, 'const')).toBe('keyword');
    expect(roleOf(rows, '42')).toBe('literal');
    expect(roleOf(rows, '// answer')).toBe('comment');
    expect(roleOf(rows, '"hi"')).toBe('literal');
    expect(rows.flat().every((span) => span.code)).toBe(true);
  });

  it('accepts a language’s aliases', () => {
    expect(roleOf(highlightCode('def f(): pass', 'py'), 'def')).toBe('keyword');
  });

  it('keeps one row per source line, even through a multi-line comment', () => {
    const code = 'a();\n/* one\ntwo */\n\nb();';
    const rows = highlightCode(code, 'js');
    expect(rows.map(lineText)).toEqual(code.split('\n'));
    expect(roleOf(rows, 'two */')).toBe('comment');
  });

  it('treats interpolated code in a template string as code again', () => {
    const rows = highlightCode('`a ${b} c`', 'js');
    expect(roleOf(rows, '`a ')).toBe('literal');
    expect(roleOf(rows, '${b}')).toBe('plain');
  });

  it('leaves an unknown or missing language as plain code', () => {
    for (const lang of ['klingon', undefined]) {
      expect(highlightCode('const x = 1', lang)).toEqual([[{ code: true, text: 'const x = 1' }]]);
    }
  });
});
