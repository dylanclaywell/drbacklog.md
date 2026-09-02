// One-time migration from the pre-rename (hospital-themed) backlog.md format
// to the current one: CRITICAL/STABLE/ARCHIVED headings -> TODO/DONE/CLOSED,
// "Patient Ledger" -> "Task Details", the "Admitted" field -> "Created".
//
// Detection is a cheap line-anchored sniff rather than a full parse, so it's
// safe to call on every load without cost. Markers are matched only where the
// parser itself would treat them as structural (a whole `## heading` line, or
// a `* **Admitted:**` field line), not as a substring anywhere in the file —
// otherwise a task whose own text happens to mention e.g. "Patient Ledger"
// would be misdetected as a legacy file. The store gates on isLegacyFormat and
// only migrates when the caller (an MCP tool) has passed an explicit opt-in
// flag, so an old file is never silently rewritten out from under a human
// mid-edit.

import { parseLegacy } from './parse.js';
import { render } from './render.js';
import { DEFAULT_TITLE } from './model.js';

const LEGACY_HEADING_LINES: ReadonlySet<string> = new Set([
  '## 🚨 CRITICAL (TODO)',
  '## 🩺 STABLE (DONE)',
  '## 🗂️ ARCHIVED (CLOSED)',
  '## 🔬 Patient Ledger (Task Details)',
]);

const LEGACY_FIELD_RE = /^\*\s+\*\*Admitted:\*\*/;

/** The pre-rename default H1 title, swapped for the current default on migration. */
const LEGACY_DEFAULT_TITLE = '🏥 DrBacklog Patient Chart';

/** True if `content` has any pre-rename heading or field name, as a structural line. */
export function isLegacyFormat(content: string): boolean {
  return content
    .split(/\r?\n/)
    .some((line) => LEGACY_HEADING_LINES.has(line.trim()) || LEGACY_FIELD_RE.test(line));
}

/** Convert pre-rename backlog.md text to the current canonical format. */
export function migrateContent(content: string): string {
  const doc = parseLegacy(content);
  // Only swap the title if it's still the old default — a human-chosen title
  // is passthrough content and stays untouched, same as any other hand-edit.
  if (doc.title === LEGACY_DEFAULT_TITLE) doc.title = DEFAULT_TITLE;
  return render(doc);
}
