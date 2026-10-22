// Markdown for the detail view: a task's description turned into styled,
// pre-wrapped rows. Read-only display — the editor and backlog.md always see
// the raw text. Only the common subset is understood (headings, lists, task
// checkboxes, quotes, rules, code, and **bold** / *italic* / ~~strike~~ /
// `code` / [links](url) inline); anything else shows as written.
//
// The detail panel scrolls by slicing rows, so wrapping happens here, after
// the markers are stripped, rather than in Ink: each row is guaranteed to fit
// `width`, counted in characters like `wrapText`.

import { highlightCode } from './highlight.js';

/**
 * What a token in highlighted code is, for the few roles the TUI colors.
 * 'plain' is highlighted code that's none of the others (names, punctuation),
 * as opposed to code nobody highlighted.
 */
export type SyntaxRole = 'keyword' | 'literal' | 'comment' | 'plain';

/** How a run of text is drawn. Semantic, so the TUI owns the actual colors. */
export interface SpanStyle {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  code?: boolean;
  dim?: boolean;
  syntax?: SyntaxRole;
}

export interface Span extends SpanStyle {
  text: string;
}

/** One screen row. An empty array is a blank row. */
export type StyledLine = Span[];

const STYLE_KEYS = ['bold', 'italic', 'strike', 'underline', 'code', 'dim'] as const;

function sameStyle(a: SpanStyle, b: SpanStyle): boolean {
  return a.syntax === b.syntax && STYLE_KEYS.every((k) => !!a[k] === !!b[k]);
}

function styleOf(span: Span): SpanStyle {
  const { text: _text, ...style } = span;
  return style;
}

/** Join neighbouring spans that look the same, so a row is as few <Text>s as possible. */
function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    if (span.text === '') continue;
    const last = out.at(-1);
    if (last && sameStyle(last, span)) last.text += span.text;
    else out.push({ ...span });
  }
  return out;
}

export function lineText(line: StyledLine): string {
  return line.map((s) => s.text).join('');
}

// ---------------------------------------------------------------------------
// Inline

// ASCII punctuation, the characters a backslash can escape.
const ESCAPABLE = /[!-/:-@[-`{-~]/;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Emphasis markers, longest first so `**` isn't read as two `*`s. */
const DELIMITERS: ReadonlyArray<{ mark: string; style: SpanStyle }> = [
  { mark: '**', style: { bold: true } },
  { mark: '__', style: { bold: true } },
  { mark: '~~', style: { strike: true } },
  { mark: '*', style: { italic: true } },
  { mark: '_', style: { italic: true } },
];

const LINK = /^\[([^\]]+)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/;

/**
 * Where the emphasis opened by `mark` at `start` closes, or -1 if it doesn't.
 * Follows CommonMark loosely: an opener must be followed by a non-space and a
 * closer preceded by one, and `_` only counts at word edges, so snake_case
 * names stay as they are.
 */
function findClose(text: string, start: number, mark: string): number {
  const underscore = mark[0] === '_';
  const after = text[start + mark.length];
  if (after === undefined || /\s/.test(after)) return -1;
  if (underscore && start > 0 && WORD_CHAR.test(text[start - 1]!)) return -1;
  for (let j = start + mark.length + 1; j < text.length; j++) {
    if (text[j] === '\\') {
      j++;
      continue;
    }
    if (!text.startsWith(mark, j)) continue;
    let run = 1;
    while (text[j + run] === mark[0]) run++;
    const before = text[j - 1]!;
    const next = text[j + run];
    // Look at the whole run of marker characters at once. A run of exactly
    // this marker closes it; a run of three closes an inner one too, so this
    // one closes at its end (`**a *b***`); any other run belongs to something
    // else, like the `**` inside `*a **b** c*`.
    if (/\s/.test(before) || (run !== mark.length && run !== 3)) {
      j += run - 1;
      continue;
    }
    if (underscore && next !== undefined && WORD_CHAR.test(next)) continue;
    return j + run - mark.length;
  }
  return -1;
}

/** Split one line of markdown into styled spans, dropping the markers. */
export function parseInline(text: string, style: SpanStyle = {}): Span[] {
  const out: Span[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ ...style, text: plain });
    plain = '';
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;

    if (ch === '\\' && i + 1 < text.length && ESCAPABLE.test(text[i + 1]!)) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === '`') {
      const run = /^`+/.exec(text.slice(i))![0];
      const close = text.indexOf(run, i + run.length);
      if (close !== -1) {
        flush();
        out.push({ ...style, code: true, text: text.slice(i + run.length, close) });
        i = close + run.length;
      } else {
        plain += run;
        i += run.length;
      }
      continue;
    }

    const delimiter = DELIMITERS.find((d) => text.startsWith(d.mark, i));
    if (delimiter) {
      const close = findClose(text, i, delimiter.mark);
      if (close !== -1) {
        flush();
        const inner = text.slice(i + delimiter.mark.length, close);
        out.push(...parseInline(inner, { ...style, ...delimiter.style }));
        i = close + delimiter.mark.length;
        continue;
      }
      // Not emphasis: keep the whole run of markers as text.
      plain += delimiter.mark;
      i += delimiter.mark.length;
      continue;
    }

    // [text](url) shows its text underlined; the URL is in the raw view.
    // An image shows its alt text, dimmed.
    const image = ch === '!' && text[i + 1] === '[';
    const link = ch === '[' || image ? LINK.exec(text.slice(image ? i + 1 : i)) : null;
    if (link) {
      flush();
      out.push(
        ...parseInline(link[1]!, { ...style, ...(image ? { dim: true } : { underline: true }) }),
      );
      i += link[0].length + (image ? 1 : 0);
      continue;
    }

    plain += ch;
    i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Wrapping

/** A word and the style of the space before it (an underlined link keeps its spaces underlined). */
interface Word {
  pieces: Span[];
  gap: SpanStyle;
}

function toWords(spans: Span[]): Word[] {
  const words: Word[] = [];
  let current: Word | null = null;
  let gap: SpanStyle = {};
  for (const span of spans) {
    const style = styleOf(span);
    for (const part of span.text.split(/(\s+)/)) {
      if (part === '') continue;
      if (/^\s/.test(part)) {
        if (current) words.push(current);
        current = null;
        gap = style;
      } else {
        current ??= { pieces: [], gap };
        current.pieces.push({ ...style, text: part });
      }
    }
  }
  if (current) words.push(current);
  return words;
}

const width = (spans: Span[]) => spans.reduce((n, s) => n + s.text.length, 0);

/** Split `pieces` after `count` characters. */
function splitPieces(pieces: Span[], count: number): [Span[], Span[]] {
  const head: Span[] = [];
  const tail: Span[] = [];
  let left = count;
  for (const piece of pieces) {
    if (left >= piece.text.length) {
      head.push(piece);
      left -= piece.text.length;
    } else if (left > 0) {
      head.push({ ...piece, text: piece.text.slice(0, left) });
      tail.push({ ...piece, text: piece.text.slice(left) });
      left = 0;
    } else {
      tail.push(piece);
    }
  }
  return [head, tail];
}

/**
 * Word-wrap spans to `cols`. The first row starts with `lead` (a bullet, a
 * quote bar) and later rows with `hang`, so a list item's text lines up under
 * itself.
 */
function wrapSpans(
  spans: Span[],
  cols: number,
  lead: Span[] = [],
  hang: Span[] = [],
): StyledLine[] {
  // A lead-in eating half the row leaves too little room to hang text under:
  // let it wrap with the words instead.
  if (lead.length > 0 && width(lead) >= cols / 2) {
    spans = [...lead, ...spans];
    lead = [];
    hang = [];
  }

  const lines: StyledLine[] = [];
  let line: Span[] = [...lead];
  let empty = true; // no word on `line` yet
  const breakLine = () => {
    lines.push(merge(line));
    line = [...hang];
    empty = true;
  };
  for (const word of toWords(spans)) {
    let pieces = word.pieces;
    while (pieces.length > 0) {
      const used = width(line);
      const sep = empty ? 0 : 1;
      if (used + sep + width(pieces) <= cols) {
        if (!empty) line.push({ ...word.gap, text: ' ' });
        line.push(...pieces);
        empty = false;
        pieces = [];
      } else if (empty) {
        // Longer than a whole row (a URL, say): split it where it hits the edge.
        const [head, tail] = splitPieces(pieces, Math.max(1, cols - used));
        line.push(...head);
        pieces = tail;
        breakLine();
      } else {
        breakLine();
      }
    }
  }
  if (!empty || lines.length === 0) lines.push(merge(line));
  return lines;
}

/** Cut a row at the edge without reflowing it, for code and tables. */
function hardWrap(spans: Span[], cols: number): StyledLine[] {
  const lines: StyledLine[] = [];
  let rest = spans;
  do {
    const [head, tail] = splitPieces(rest, cols);
    lines.push(merge(head));
    rest = tail;
  } while (rest.length > 0);
  return lines;
}

// ---------------------------------------------------------------------------
// Blocks

const FENCE = /^\s*```/;
const INDENTED_CODE = /^( {4}|\t)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s*((?:>\s?)+)(.*)$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const TABLE_ROW = /^\s*\|/;

/**
 * Render markdown to rows of styled spans, wrapped to `cols`. Each source
 * line is handled on its own and blank lines are kept, matching `wrapText`.
 */
export function renderMarkdown(text: string, cols: number): StyledLine[] {
  const w = Math.max(1, cols);
  const out: StyledLine[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      // The fences themselves aren't shown; the code's color sets it apart.
      // The block is highlighted whole, so a comment or string spanning
      // lines is still read as one. An unclosed fence runs to the end.
      const lang = line.trim().slice(3).trim().split(/\s/)[0];
      const close = lines.findIndex((l, j) => j > i && FENCE.test(l));
      const end = close === -1 ? lines.length : close;
      const code = lines.slice(i + 1, end).join('\n');
      if (end > i + 1) for (const row of highlightCode(code, lang)) out.push(...hardWrap(row, w));
      i = end;
      continue;
    }
    if (line.trim() === '') {
      out.push([]);
      continue;
    }
    if (INDENTED_CODE.test(line) && !LIST_ITEM.test(line)) {
      out.push(...hardWrap([{ code: true, text: line }], w));
      continue;
    }
    if (TABLE_ROW.test(line)) {
      out.push(...hardWrap([{ text: line }], w));
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(...wrapSpans(parseInline(heading[2]!, { bold: true, underline: level <= 2 }), w));
      continue;
    }

    if (RULE.test(line)) {
      out.push([{ dim: true, text: '─'.repeat(w) }]);
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      const depth = quote[1]!.split('>').length - 1;
      const bar = [{ dim: true, text: '▍ '.repeat(depth) }];
      out.push(...wrapSpans(parseInline(quote[2]!, { italic: true }), w, bar, bar));
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const [, indent = '', marker = '', check, body = ''] = item;
      const bullet = /\d/.test(marker) ? marker : '•';
      const box = check === undefined ? '' : check === ' ' ? '☐ ' : '☑ ';
      const lead = `${indent}${bullet} ${box}`;
      // A finished checklist item reads as done: dimmed, like the resolution.
      const style: SpanStyle = check !== undefined && check !== ' ' ? { dim: true } : {};
      out.push(
        ...wrapSpans(
          parseInline(body, style),
          w,
          [{ text: lead }],
          [{ text: ' '.repeat(lead.length) }],
        ),
      );
      continue;
    }

    out.push(...wrapSpans(parseInline(line.trim()), w));
  }
  return out;
}
