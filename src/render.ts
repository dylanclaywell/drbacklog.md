// Renderer: BacklogDocument -> backlog.md text.
//
// Emits the canonical file layout the parser expects, so a render -> parse
// round trip is lossless and render is idempotent. The top index is rebuilt
// from the ledger every time (all three wards always appear, even when empty),
// and each task gets a stable `<a id="task-N">` anchor derived from its id.

import { anchorFor, LEDGER_HEADING, WARDS } from './model.js';
import type { BacklogDocument, Task } from './model.js';

/**
 * Emit a `* **Label:** value` bullet, spilling any newlines in the value onto
 * following lines (the shape the parser reads back as a multi-line field).
 */
function pushField(lines: string[], label: string, value: string): void {
  const [head = '', ...rest] = value.split('\n');
  lines.push(`* **${label}:**${head === '' ? '' : ` ${head}`}`);
  lines.push(...rest);
}

/** The index list for one ward: its heading plus a checkbox line per task. */
function renderWard(
  status: Task['status'],
  heading: string,
  checkbox: string,
  tasks: Task[],
): string[] {
  const lines = [`## ${heading}`];
  for (const task of tasks) {
    if (task.status !== status) continue;
    lines.push(`- [${checkbox}] [#${task.id}: ${task.title}](#${anchorFor(task.id)})`);
  }
  return lines;
}

/** One ledger detail block: anchor, heading, fields, then preserved extras. */
function renderTask(task: Task): string[] {
  const lines = [`<a id="${anchorFor(task.id)}"></a>`, `### #${task.id}: ${task.title}`];
  lines.push(`* **Status:** ${task.status}`);
  lines.push(`* **Admitted:** ${task.admitted}`);
  pushField(lines, 'Description', task.description);
  if (task.resolution !== undefined) pushField(lines, 'Resolution', task.resolution);
  lines.push(...task.extraLines);
  return lines;
}

/** Join blocks with a single blank line between them and a trailing newline. */
function joinBlocks(blocks: string[][]): string {
  return blocks.map((block) => block.join('\n')).join('\n\n') + '\n';
}

/** The three ward index lists, in order. */
function wardBlocks(doc: BacklogDocument): string[][] {
  return WARDS.map((ward) => renderWard(ward.status, ward.heading, ward.checkbox, doc.tasks));
}

export function render(doc: BacklogDocument): string {
  // Each entry is one block; blocks are joined by a single blank line.
  const blocks: string[][] = [[`# ${doc.title}`]];

  if (doc.passthrough.preamble.length > 0) blocks.push([...doc.passthrough.preamble]);

  blocks.push(...wardBlocks(doc));

  blocks.push(['---']);

  if (doc.passthrough.midNotes.length > 0) blocks.push([...doc.passthrough.midNotes]);

  blocks.push([`## ${LEDGER_HEADING}`]);

  for (const task of doc.tasks) blocks.push(renderTask(task));

  return joinBlocks(blocks);
}

/**
 * Render only the index (title + three ward lists), omitting the ledger. This
 * is the token-efficient backlog summary — the same top-of-file view the parser
 * treats as derived.
 */
export function renderSummary(doc: BacklogDocument): string {
  return joinBlocks([[`# ${doc.title}`], ...wardBlocks(doc)]);
}
