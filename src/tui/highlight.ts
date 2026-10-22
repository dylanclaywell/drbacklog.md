// Syntax highlighting for fenced code in the detail view. lowlight runs
// highlight.js but hands back a token tree rather than colored text, so the
// tokens can become spans that wrap and scroll like the rest of a description.
//
// Deliberately muted: tokens collapse into three roles (keywords, literals,
// comments) and the TUI gives each a single color, so code never brings in a
// theme's worth of colors to compete with status and priority.

import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

import type { Span, SyntaxRole } from './markdown.js';

// Only the languages a backlog is likely to quote; each grammar costs load
// time, and a fence in anything else just shows as plain code.
const lowlight = createLowlight({
  bash,
  csharp,
  css,
  diff,
  javascript,
  json,
  markdown,
  python,
  sql,
  typescript,
  xml,
  yaml,
});

/**
 * highlight.js class -> role. `null` drops back to plain code: a template
 * string's `${...}` is code again, not part of the string around it.
 * Classes not listed inherit from whatever encloses them.
 */
const ROLES: Record<string, SyntaxRole | null> = {
  keyword: 'keyword',
  built_in: 'keyword',
  type: 'keyword',
  string: 'literal',
  number: 'literal',
  literal: 'literal',
  regexp: 'literal',
  symbol: 'literal',
  comment: 'comment',
  quote: 'comment',
  subst: null,
};

/** The slice of a hast tree the walk reads. */
interface HastNode {
  type: string;
  value?: string;
  children?: HastNode[];
  properties?: { className?: unknown };
}

function roleOf(node: HastNode, inherited: SyntaxRole | undefined): SyntaxRole | undefined {
  const classes = node.properties?.className;
  const first = Array.isArray(classes) ? String(classes[0] ?? '') : '';
  const name = first.replace(/^hljs-/, '');
  if (!(name in ROLES)) return inherited;
  return ROLES[name] ?? undefined;
}

/**
 * Highlight a code block, one span list per source line. `lang` is the
 * fence's info string (`ts`, `python`, ...); an unknown or missing one gives
 * plain code rather than a guess, since auto-detection is unreliable on the
 * short snippets a task tends to quote.
 */
export function highlightCode(code: string, lang: string | undefined): Span[][] {
  const lines = code.split('\n');
  if (!lang || !lowlight.registered(lang)) {
    return lines.map((line) => (line === '' ? [] : [{ code: true, text: line }]));
  }

  const out: Span[][] = [[]];
  const walk = (node: HastNode, role: SyntaxRole | undefined) => {
    if (node.type === 'text') {
      const [first = '', ...rest] = (node.value ?? '').split('\n');
      const push = (text: string) => {
        if (text) out.at(-1)!.push({ code: true, syntax: role ?? 'plain', text });
      };
      push(first);
      for (const text of rest) {
        out.push([]);
        push(text);
      }
      return;
    }
    const own = node.type === 'element' ? roleOf(node, role) : role;
    for (const child of node.children ?? []) walk(child, own);
  };
  walk(lowlight.highlight(lang, code), undefined);
  return out;
}
