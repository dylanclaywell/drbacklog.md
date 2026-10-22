// Tests for the detail view's markdown: which markers are understood, what
// they turn into, and that wrapping still keeps every row within the width.

import { describe, expect, it } from 'vitest';

import { lineText, parseInline, renderMarkdown } from './markdown.js';

const texts = (markdown: string, width = 80) => renderMarkdown(markdown, width).map(lineText);

describe('parseInline', () => {
  it('styles bold, italic, strikethrough and code, dropping the markers', () => {
    expect(parseInline('a **b** *c* ~~d~~ `e`')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', italic: true },
      { text: ' ' },
      { text: 'd', strike: true },
      { text: ' ' },
      { text: 'e', code: true },
    ]);
  });

  it('nests emphasis', () => {
    expect(parseInline('**bold *both***')).toEqual([
      { text: 'bold ', bold: true },
      { text: 'both', bold: true, italic: true },
    ]);
    expect(parseInline('*a **b** c*')).toEqual([
      { text: 'a ', italic: true },
      { text: 'b', italic: true, bold: true },
      { text: ' c', italic: true },
    ]);
  });

  it('shows a link’s text underlined, without the URL', () => {
    expect(parseInline('see [the docs](https://example.com) now')).toEqual([
      { text: 'see ' },
      { text: 'the docs', underline: true },
      { text: ' now' },
    ]);
  });

  it('leaves markers that open nothing as text', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ text: '2 * 3 * 4' }]);
    expect(parseInline('snake_case_name')).toEqual([{ text: 'snake_case_name' }]);
    expect(parseInline('**unclosed')).toEqual([{ text: '**unclosed' }]);
  });

  it('does not read markers inside code', () => {
    expect(parseInline('`a *b* c`')).toEqual([{ text: 'a *b* c', code: true }]);
  });

  it('honors backslash escapes', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([{ text: '*not italic*' }]);
  });
});

describe('renderMarkdown', () => {
  it('drops heading hashes and bolds the heading', () => {
    expect(renderMarkdown('## Plan', 40)).toEqual([
      [{ text: 'Plan', bold: true, underline: true }],
    ]);
    expect(renderMarkdown('### Notes', 40)).toEqual([
      [{ text: 'Notes', bold: true, underline: false }],
    ]);
  });

  it('draws bullets and checkboxes, hanging wrapped lines under the text', () => {
    expect(texts('- one two three four', 10)).toEqual(['• one two', '  three', '  four']);
    expect(texts('12. alpha beta gamma', 12)).toEqual(['12. alpha', '    beta', '    gamma']);
    expect(texts('- [ ] todo\n- [x] done')).toEqual(['• ☐ todo', '• ☑ done']);
  });

  it('dims a checked item', () => {
    expect(renderMarkdown('- [x] done', 40)[0]).toEqual([
      { text: '• ☑ ' },
      { text: 'done', dim: true },
    ]);
  });

  it('marks quotes with a bar on every wrapped row', () => {
    expect(texts('> one two three', 9)).toEqual(['▍ one two', '▍ three']);
  });

  it('turns a rule into a line across the width', () => {
    expect(texts('---', 5)).toEqual(['─────']);
  });

  it('hides fences and keeps code unreflowed', () => {
    const rows = renderMarkdown('```ts\nif (x)   {  y();  }\n```', 10);
    expect(rows.map(lineText)).toEqual(['if (x)   {', '  y();  }']);
    expect(rows.every((row) => row.every((span) => span.code))).toBe(true);
  });

  it('highlights a fenced block in a known language, cutting tokens at the edge', () => {
    const rows = renderMarkdown('```ts\nconst greeting = "hello";\n```', 12);
    expect(rows.map(lineText)).toEqual(['const greeti', 'ng = "hello"', ';']);
    expect(rows[0]![0]).toEqual({ code: true, syntax: 'keyword', text: 'const' });
    expect(rows[1]!.find((span) => span.text === '"hello"')?.syntax).toBe('literal');
  });

  it('runs an unclosed fence to the end', () => {
    expect(texts('```\nstill code')).toEqual(['still code']);
  });

  it('keeps blank lines between paragraphs', () => {
    expect(texts('first\n\nsecond')).toEqual(['first', '', 'second']);
  });

  it('keeps a style across a wrap and splits words too long for a row', () => {
    expect(renderMarkdown('**aaa bbb**', 3)).toEqual([
      [{ text: 'aaa', bold: true }],
      [{ text: 'bbb', bold: true }],
    ]);
    expect(texts('see https://example.com/a/long/path', 12)).toEqual([
      'see',
      'https://exam',
      'ple.com/a/lo',
      'ng/path',
    ]);
  });

  it('never returns a row longer than the width', () => {
    const text =
      '# A heading that runs long\n- a **list item** that runs `long`\n> quoted [link](x) text\n\nand more prose';
    for (const width of [1, 5, 13, 40]) {
      for (const row of texts(text, width)) expect(row.length).toBeLessThanOrEqual(width);
    }
  });
});
