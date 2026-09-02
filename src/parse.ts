// Parser: backlog.md text -> BacklogDocument.
//
// The details zone (bottom) is authoritative for all task data. The top index
// is a derived projection that the renderer rebuilds, so this parser reads the
// index only to skip past it and never trusts it for task content. Anything the
// parser cannot map to known structure is captured verbatim (document-level in
// Passthrough, per-task in Task.extraLines) so a parse -> render round trip
// preserves human edits.
//
// `parse` reads only the current canonical headings/field names. `parseLegacy`
// is the same state machine driven by a dialect that also recognizes the
// pre-rename headings and the old `Admitted` field name, so a legacy file can
// be read once for migration (see migrate.ts) without teaching the canonical
// parser about a format it should never write.
//
// Epics are an entirely optional trailing zone: a document with none never
// enters the 'epics' state below, so a backlog.md with no epics round-trips
// identically to before epics existed.

import { DEFAULT_TITLE, DETAILS_HEADING, EPICS_HEADING, SECTIONS } from './model.js';
import type { BacklogDocument, Epic, Passthrough, Task, TaskStatus } from './model.js';

type FieldKey = 'status' | 'created' | 'epic' | 'description' | 'resolution';

const H1_RE = /^#\s+(.*\S)\s*$/;
const H2_RE = /^##\s+(.*\S)\s*$/;
const DIVIDER_RE = /^-{3,}\s*$/;
const ANCHOR_RE = /^<a\s+id="(?:task|epic)-\d+"\s*><\/a>\s*$/i;
const INDEX_ITEM_RE = /^-\s*\[[ xX]\]\s+\[.*\]\(#.*\)\s*$/;
const TASK_HEADING_RE = /^###\s+#(\d+):\s*(.*?)\s*$/;
const EPIC_HEADING_RE = /^###\s+Epic\s+#(\d+):\s*(.*?)\s*$/;
// Matches any `* **Key:** value` bullet; the key is classified afterward.
const FIELD_RE = /^\*\s+\*\*([^:*]+):\*\*\s?(.*)$/;
// An epic reference field's value is just `#5` (or `5`); no markdown link.
const EPIC_REF_RE = /^#?(\d+)/;

const KNOWN_FIELDS: ReadonlySet<string> = new Set<FieldKey>([
  'status',
  'created',
  'epic',
  'description',
  'resolution',
]);

// Epic blocks recognize only Description; epics have no status/created/epic
// fields of their own.
const KNOWN_EPIC_FIELDS: ReadonlySet<string> = new Set(['description']);

/**
 * The vocabulary a parse pass recognizes. The canonical dialect matches only
 * what the renderer emits today; the legacy dialect additionally matches the
 * pre-rename headings and field name so an old file can be read once.
 */
interface Dialect {
  sectionHeadings: ReadonlySet<string>;
  detailsHeadings: ReadonlySet<string>;
  epicsHeadings: ReadonlySet<string>;
  /** Maps a lowercased legacy field key to the canonical `FieldKey` it means. */
  fieldAliases: Readonly<Partial<Record<string, FieldKey>>>;
}

const CURRENT_DIALECT: Dialect = {
  sectionHeadings: new Set(SECTIONS.map((s) => s.heading)),
  detailsHeadings: new Set([DETAILS_HEADING]),
  epicsHeadings: new Set([EPICS_HEADING]),
  fieldAliases: {},
};

const isBlank = (line: string): boolean => line.trim() === '';
const isDivider = (line: string): boolean => DIVIDER_RE.test(line);
const isAnchor = (line: string): boolean => ANCHOR_RE.test(line);
const isIndexItem = (line: string): boolean => INDEX_ITEM_RE.test(line);

function matchH1(line: string): string | null {
  const m = H1_RE.exec(line);
  return m ? (m[1] ?? '') : null;
}

function h2Text(line: string): string | null {
  const m = H2_RE.exec(line);
  return m ? (m[1] ?? '') : null;
}

function isSectionHeading(line: string, dialect: Dialect): boolean {
  const text = h2Text(line);
  return text !== null && dialect.sectionHeadings.has(text);
}

function isDetailsHeading(line: string, dialect: Dialect): boolean {
  const text = h2Text(line);
  return text !== null && dialect.detailsHeadings.has(text);
}

function isEpicsHeading(line: string, dialect: Dialect): boolean {
  const text = h2Text(line);
  return text !== null && dialect.epicsHeadings.has(text);
}

function matchTaskHeading(line: string): { id: number; title: string } | null {
  const m = TASK_HEADING_RE.exec(line);
  if (!m) return null;
  const [, idStr = '', title = ''] = m;
  return { id: Number(idStr), title };
}

function matchEpicHeading(line: string): { id: number; title: string } | null {
  const m = EPIC_HEADING_RE.exec(line);
  if (!m) return null;
  const [, idStr = '', title = ''] = m;
  return { id: Number(idStr), title };
}

function matchField(line: string, dialect: Dialect): { key: FieldKey; value: string } | null {
  const m = FIELD_RE.exec(line);
  if (!m) return null;
  const [, rawKey = '', value = ''] = m;
  const key = rawKey.trim().toLowerCase();
  const resolved = dialect.fieldAliases[key] ?? key;
  return KNOWN_FIELDS.has(resolved) ? { key: resolved as FieldKey, value } : null;
}

/** Epic blocks only ever recognize Description; no dialect/aliases needed. */
function matchEpicField(line: string): { value: string } | null {
  const m = FIELD_RE.exec(line);
  if (!m) return null;
  const [, rawKey = '', value = ''] = m;
  return KNOWN_EPIC_FIELDS.has(rawKey.trim().toLowerCase()) ? { value } : null;
}

/** Parse an epic reference field's value (`#5` or `5`) to an id, if valid. */
function parseEpicRef(value: string): number | undefined {
  const m = EPIC_REF_RE.exec(value.trim());
  return m ? Number(m[1]) : undefined;
}

function parseStatus(value: string): TaskStatus {
  const v = value.trim().toUpperCase();
  if (v === 'DONE') return 'DONE';
  if (v === 'CLOSED') return 'CLOSED';
  return 'TODO';
}

function applyField(task: Task, key: FieldKey, value: string): void {
  switch (key) {
    case 'status':
      task.status = parseStatus(value);
      break;
    case 'created':
      task.created = value.trim();
      break;
    case 'epic':
      task.epicId = parseEpicRef(value);
      break;
    case 'description':
      task.description = value;
      break;
    case 'resolution':
      task.resolution = value;
      break;
  }
}

/** Remove leading and trailing blank lines while preserving interior spacing. */
function trimBlankEdges(lines: string[]): string[] {
  const first = lines.findIndex((line) => !isBlank(line));
  if (first === -1) return []; // empty or all-blank
  const last = lines.findLastIndex((line) => !isBlank(line));
  return lines.slice(first, last + 1);
}

// The parser walks the file top to bottom; `state` tracks which zone the
// current line is in:
//
//   preTitle    lines before the `# ` title (usually none)
//   preamble    notes between the title and the first section
//   index       the status section lists (derived; discarded and rebuilt on render)
//   midNotes    notes after the index / divider, before the details zone
//   details     the task detail blocks (the authoritative task data)
//   epics       the optional epic detail blocks, after the task details
type State = 'preTitle' | 'preamble' | 'index' | 'midNotes' | 'details' | 'epics';

function parseWithDialect(content: string, dialect: Dialect): BacklogDocument {
  const lines = content.split(/\r?\n/);

  let title = DEFAULT_TITLE;
  const preamble: string[] = [];
  const midNotes: string[] = [];
  const tasks: Task[] = [];
  const epics: Epic[] = [];

  let state: State = 'preTitle';
  // The task currently being filled in the details zone, and which multi-line
  // field (if any) trailing prose should append to.
  let cur: Task | null = null;
  let curField: 'description' | 'resolution' | null = null;
  // Same idea, for the epic currently being filled in the epics zone.
  let curEpic: Epic | null = null;
  let curEpicField: 'description' | null = null;

  for (const line of lines) {
    switch (state) {
      case 'preTitle': {
        const h1 = matchH1(line);
        if (h1 !== null) {
          title = h1;
          state = 'preamble';
        } else {
          preamble.push(line);
        }
        break;
      }

      case 'preamble': {
        if (isDetailsHeading(line, dialect)) state = 'details';
        else if (isEpicsHeading(line, dialect)) state = 'epics';
        else if (isSectionHeading(line, dialect)) state = 'index';
        else if (isDivider(line)) state = 'midNotes';
        else preamble.push(line);
        break;
      }

      case 'index': {
        // The index is derived and rebuilt on render, so drop its headings and
        // list items; keep only stray human prose.
        if (isDetailsHeading(line, dialect)) state = 'details';
        else if (isEpicsHeading(line, dialect)) state = 'epics';
        else if (isDivider(line)) state = 'midNotes';
        else if (isSectionHeading(line, dialect) || isIndexItem(line) || isBlank(line)) break;
        else midNotes.push(line);
        break;
      }

      case 'midNotes': {
        if (isDetailsHeading(line, dialect)) state = 'details';
        else if (isEpicsHeading(line, dialect)) state = 'epics';
        else if (isSectionHeading(line, dialect)) state = 'index';
        else if (isDivider(line) || isBlank(line)) break;
        else midNotes.push(line);
        break;
      }

      case 'details': {
        if (isEpicsHeading(line, dialect)) {
          state = 'epics';
          curField = null;
          break;
        }

        if (isAnchor(line)) {
          // Anchors are regenerated from the task id on render.
          curField = null;
          break;
        }

        const head = matchTaskHeading(line);
        if (head) {
          cur = {
            id: head.id,
            title: head.title,
            description: '',
            status: 'TODO',
            created: '',
            extraLines: [],
          };
          tasks.push(cur);
          curField = null;
          break;
        }

        if (!cur) {
          // Freeform prose before the first task block.
          if (!isBlank(line)) midNotes.push(line);
          break;
        }

        const field = matchField(line, dialect);
        if (field) {
          applyField(cur, field.key, field.value);
          curField =
            field.key === 'description'
              ? 'description'
              : field.key === 'resolution'
                ? 'resolution'
                : null;
          break;
        }

        // Not a recognized field. An unrecognized `* **Key:** value` bullet is
        // preserved verbatim, same as any other stray line.
        if (FIELD_RE.test(line)) {
          cur.extraLines.push(line);
          curField = null;
          break;
        }

        // Non-field line inside a task block. A blank line ends the current
        // field; consecutive non-blank lines continue a multi-line field;
        // anything else is preserved verbatim.
        if (isBlank(line)) {
          curField = null;
        } else if (curField === 'description') {
          cur.description += '\n' + line;
        } else if (curField === 'resolution') {
          cur.resolution = (cur.resolution ?? '') + '\n' + line;
        } else {
          cur.extraLines.push(line);
        }
        break;
      }

      case 'epics': {
        if (isAnchor(line)) {
          curEpicField = null;
          break;
        }

        const head = matchEpicHeading(line);
        if (head) {
          curEpic = { id: head.id, title: head.title, description: '', extraLines: [] };
          epics.push(curEpic);
          curEpicField = null;
          break;
        }

        if (!curEpic) {
          if (!isBlank(line)) midNotes.push(line);
          break;
        }

        const field = matchEpicField(line);
        if (field) {
          curEpic.description = field.value;
          curEpicField = 'description';
          break;
        }

        if (FIELD_RE.test(line)) {
          curEpic.extraLines.push(line);
          curEpicField = null;
          break;
        }

        if (isBlank(line)) {
          curEpicField = null;
        } else if (curEpicField === 'description') {
          curEpic.description += '\n' + line;
        } else {
          curEpic.extraLines.push(line);
        }
        break;
      }
    }
  }

  for (const task of tasks) {
    task.description = task.description.trimEnd();
    if (task.resolution !== undefined) task.resolution = task.resolution.trimEnd();
  }
  for (const epic of epics) {
    epic.description = epic.description.trimEnd();
  }

  const passthrough: Passthrough = {
    preamble: trimBlankEdges(preamble),
    midNotes: trimBlankEdges(midNotes),
  };

  return { title, tasks, epics, passthrough };
}

/** Parse canonical-format backlog.md text (what the renderer emits today). */
export function parse(content: string): BacklogDocument {
  return parseWithDialect(content, CURRENT_DIALECT);
}

// Pre-rename (hospital-themed) headings and field name, recognized only by
// parseLegacy for one-time migration (see migrate.ts). Also accepts the
// current headings, so a partially hand-edited file still parses. Epics
// postdate the rename, so they need no legacy vocabulary of their own.
const LEGACY_DIALECT: Dialect = {
  sectionHeadings: new Set([
    ...CURRENT_DIALECT.sectionHeadings,
    '🚨 CRITICAL (TODO)',
    '🩺 STABLE (DONE)',
    '🗂️ ARCHIVED (CLOSED)',
  ]),
  detailsHeadings: new Set([
    ...CURRENT_DIALECT.detailsHeadings,
    '🔬 Patient Ledger (Task Details)',
  ]),
  epicsHeadings: CURRENT_DIALECT.epicsHeadings,
  fieldAliases: { admitted: 'created' },
};

/** Parse a pre-rename backlog.md (old headings, `Admitted` field) for migration. */
export function parseLegacy(content: string): BacklogDocument {
  return parseWithDialect(content, LEGACY_DIALECT);
}
