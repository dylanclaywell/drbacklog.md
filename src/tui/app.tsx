// Root TUI component: a three-tab task list (TODO/DONE/CLOSED) with a fuzzy
// filter and a detail pane, plus a couple of mutating keybindings that go
// through the same `operations.ts` functions the MCP tools call — so TUI
// behavior never diverges from tool behavior.

import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  compareByPriority,
  findTasks,
  moveTask,
  setTaskPriority,
  TaskNotFoundError,
  updateTask,
} from '../operations.js';
import type { BacklogDocument, Task, TaskPriority, TaskStatus } from '../model.js';
import { PRIORITIES, priorityFor, SECTIONS } from '../model.js';
import { render as renderBacklog } from '../render.js';
import { LegacyFormatError } from '../store.js';
import type { BacklogStore } from '../store.js';
import { watchBacklog } from './watch.js';

export interface AppProps {
  store: BacklogStore;
  backlogPath: string;
}

const STATUS_ORDER: readonly TaskStatus[] = SECTIONS.map((s) => s.status);

/** 'list' shows one status at a time; 'board' shows all three as side-by-side cards. */
type ViewMode = 'list' | 'board';

/**
 * How the visible list is ordered. Both are display-only — neither one writes
 * to backlog.md. Reordering the file itself is the MCP `sort_backlog_by_priority`
 * tool's job, deliberately kept out of reach of a single keystroke here.
 *
 *   file      the order tasks appear in backlog.md (or fuzzy rank, when filtering)
 *   priority  HIGH first, untriaged last — the same order the sort tool writes
 */
export type SortMode = 'file' | 'priority';

/**
 * The active priority filter, also display-only. `undefined` shows everything;
 * 'NONE' shows only untriaged tasks, which is how you find work nobody has
 * triaged yet — a view you can't get by picking one of the three levels.
 */
export type PriorityFilter = TaskPriority | 'NONE' | undefined;

/** The cycle `p` steps through: all -> each level, most urgent first -> untriaged -> all. */
export const PRIORITY_FILTER_CYCLE: readonly PriorityFilter[] = [
  undefined,
  ...PRIORITIES.map((p) => p.priority),
  'NONE',
];

export function priorityFilterLabel(filter: PriorityFilter): string {
  if (filter === undefined) return 'all';
  return filter === 'NONE' ? 'untriaged' : filter;
}

export function matchesPriorityFilter(task: Task, filter: PriorityFilter): boolean {
  if (filter === undefined) return true;
  if (filter === 'NONE') return task.priority === undefined;
  return task.priority === filter;
}

/**
 * What the `P` prompt offers, left to right: each level, most urgent first,
 * then 'NONE' to clear it. Unlike the filter there's no "all" here — a task
 * holds exactly one of these.
 */
export type PriorityChoice = TaskPriority | 'NONE';
export const PRIORITY_CHOICES: readonly PriorityChoice[] = [
  ...PRIORITIES.map((p) => p.priority),
  'NONE',
];

/**
 * Where the cursor should land once a change has reshuffled the list: on the
 * same task if it's still visible (a priority sort may have moved it), else
 * on the row it used to occupy, clamped (a priority filter may have hidden it).
 */
export function selectionAfterChange(list: readonly Task[], id: number, previous: number): number {
  const index = list.findIndex((t) => t.id === id);
  if (index !== -1) return index;
  return Math.max(0, Math.min(previous, list.length - 1));
}

// Matches a paragraph's lead-in: indentation plus a list marker, if any. Wrapped
// lines of the paragraph hang under its text, the way a markdown list reads.
const PARAGRAPH_LEAD = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?/;

/** Break one long line into pieces of at most `width`, without reflowing it. */
function hardWrap(line: string, width: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < line.length; i += width) pieces.push(line.slice(i, i + width));
  return pieces.length > 0 ? pieces : [''];
}

/** Word-wrap one paragraph (one line of the source text) to `width`. */
function wrapParagraph(paragraph: string, width: number): string[] {
  let lead = PARAGRAPH_LEAD.exec(paragraph)?.[0] ?? '';
  // A lead-in eating half the line leaves too little room to hang text under.
  if (lead.length >= width / 2) lead = '';
  const hang = ' '.repeat(lead.length);
  const words = paragraph.slice(lead.length).split(/\s+/).filter(Boolean);

  const lines: string[] = [];
  let line = lead;
  let empty = true; // no word on `line` yet
  const breakLine = () => {
    lines.push(line.trimEnd());
    line = hang;
    empty = true;
  };
  for (let word of words) {
    while (word.length > 0) {
      const sep = empty ? '' : ' ';
      if (line.length + sep.length + word.length <= width) {
        line += sep + word;
        empty = false;
        word = '';
      } else if (empty) {
        // Longer than a whole line (a URL, say): split it where it hits the edge.
        const room = width - line.length;
        line += word.slice(0, room);
        word = word.slice(room);
        breakLine();
      } else {
        breakLine();
      }
    }
  }
  if (!empty || lines.length === 0) lines.push(line.trimEnd());
  return lines;
}

/**
 * Word-wrap text to `width` columns, for the detail panel's own scrolling —
 * Ink wraps text itself but never says where, so a scrolled window has to be
 * cut from lines we wrapped. Each source line is wrapped separately and blank
 * lines are kept, so paragraphs stay apart. Code (a ``` fence, or a line
 * indented four spaces or a tab) is only cut at the edge, never reflowed,
 * since its spacing carries meaning. Widths are counted in characters: a
 * double-width character (CJK, most emoji) can make a line run long.
 */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    const isFence = line.trimStart().startsWith('```');
    if (inFence || isFence || /^( {4}|\t)/.test(line)) out.push(...hardWrap(line, w));
    else if (line.trim() === '') out.push('');
    else out.push(...wrapParagraph(line, w));
    if (isFence) inFence = !inFence;
  }
  return out;
}

/** Where a task's details land in a panel of a given size. */
export interface DetailLayout {
  titleLines: string[];
  /** The scrolling part: the description, then the resolution if there is one. */
  bodyLines: string[];
  /** Index in `bodyLines` where the resolution starts (its length if there's none). */
  resolutionStart: number;
  /** How many body lines fit at once. */
  bodyRows: number;
  /** The furthest the body can scroll, in lines. */
  maxScroll: number;
}

/**
 * Lay a task out in a `width` x `height` area: its title wrapped across as
 * many rows as it needs, a status line and a blank row, then as much of the
 * body as fits, with one row kept at the bottom for the "↓ N more" hint.
 */
export function detailLayout(task: Task, width: number, height: number): DetailLayout {
  const titleLines = wrapText(`#${task.id} ${task.title}`, width);
  const bodyLines = wrapText(task.description || '—', width);
  const resolutionStart = bodyLines.length;
  if (task.resolution) bodyLines.push('', ...wrapText(`Resolution: ${task.resolution}`, width));
  const bodyRows = Math.max(1, height - titleLines.length - 2 - 1);
  return {
    titleLines,
    bodyLines,
    resolutionStart,
    bodyRows,
    maxScroll: Math.max(0, bodyLines.length - bodyRows),
  };
}

/** Every field a task carries, compared by value. */
export function sameTask(a: Task, b: Task): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.description === b.description &&
    a.status === b.status &&
    a.created === b.created &&
    a.resolution === b.resolution &&
    a.epicId === b.epicId &&
    a.priority === b.priority &&
    a.extraLines.length === b.extraLines.length &&
    a.extraLines.every((line, i) => line === b.extraLines[i])
  );
}

/** The task on disk no longer matches the one the TUI showed when the change was asked for. */
export class StaleTaskError extends Error {
  constructor(public readonly current: Task) {
    super(`#${current.id} changed on disk`);
    this.name = 'StaleTaskError';
  }
}

/**
 * Guard for a TUI write, run inside `store.mutate` so it sees the file as it
 * is right now. The TUI's copy of the backlog can be stale — an agent or an
 * editor may have changed the file since the last load — and a change made
 * from a stale screen could undo theirs (a description save) or land on a
 * different task that has since taken the same id. Throwing here aborts the
 * mutate before anything is written.
 */
export function assertTaskUnchanged(doc: BacklogDocument, seen: Task): void {
  const current = doc.tasks.find((t) => t.id === seen.id);
  if (!current) throw new TaskNotFoundError(seen.id);
  if (!sameTask(current, seen)) throw new StaleTaskError(current);
}

// A small, deliberately narrow palette: one accent color owns focus/selection
// everywhere (so "this is selected" never has to compete visually with "this
// is done"), and each status gets its own hue used consistently — in the tab
// bar, board headers, and the detail pane. Everything else stays dim/plain,
// so color always means something instead of decorating every line.
const THEME = {
  accent: '#a78bfa', // violet — selection, focus, in-progress prompts
  rule: 'gray', // hairline dividers, replacing boxed borders
  status: {
    TODO: '#38bdf8', // sky — open
    DONE: '#34d399', // emerald — shipped
    CLOSED: '#94a3b8', // slate — archived, deliberately muted
  } satisfies Record<TaskStatus, string>,
  // Warm hues, ramped by urgency, so priority never reads as another status:
  // status owns the cool end of the palette, priority the warm end.
  priority: {
    HIGH: '#f87171', // red
    MEDIUM: '#fbbf24', // amber
    LOW: '#a3a3a3', // neutral — present, but not asking for attention
  } satisfies Record<TaskPriority, string>,
} as const;

/**
 * The `!!!`/`!!`/`!` marker, colored by level — the same glyph the renderer
 * writes into backlog.md's index, so the file and the TUI agree on shape as
 * well as on meaning. Renders nothing for an untriaged task.
 */
function PriorityMark({ priority }: { priority: TaskPriority | undefined }): React.ReactElement {
  if (priority === undefined) return <></>;
  return <Text color={THEME.priority[priority]}> {priorityFor(priority).marker}</Text>;
}

/**
 * A task's details, scrolled to `scroll`: the shared body of the side panel
 * and the full-screen reader. Every row is one of `layout`'s pre-wrapped
 * lines, so what's on screen matches what the scroll keys think is there.
 */
function DetailView({
  task,
  layout,
  scroll,
}: {
  task: Task;
  layout: DetailLayout;
  scroll: number;
}): React.ReactElement {
  const top = Math.min(scroll, layout.maxScroll);
  const shown = layout.bodyLines.slice(top, top + layout.bodyRows);
  const below = layout.bodyLines.length - top - shown.length;
  const hint = [top > 0 && `↑ ${top} above`, below > 0 && `↓ ${below} more`]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      {layout.titleLines.map((line, i) => (
        <Text key={i} bold>
          {line}
        </Text>
      ))}
      <Text wrap="truncate-end">
        <Text color={THEME.status[task.status]}>
          {STATUS_PIP} {task.status}
        </Text>
        {task.priority !== undefined && (
          <Text color={THEME.priority[task.priority]}> · {task.priority}</Text>
        )}
        <Text dimColor> · created {task.created}</Text>
        {task.epicId !== undefined && <Text dimColor> · epic #{task.epicId}</Text>}
      </Text>
      <Text> </Text>
      <Box flexDirection="column" height={layout.bodyRows}>
        {shown.map((line, i) => (
          // An empty <Text> renders no row at all; a space keeps blank lines.
          <Text key={top + i} dimColor={top + i >= layout.resolutionStart}>
            {line || ' '}
          </Text>
        ))}
      </Box>
      <Box justifyContent="flex-end">
        <Text dimColor>{hint || ' '}</Text>
      </Box>
    </>
  );
}

/**
 * One glyph, reused everywhere a status needs to be recognized by shape as
 * well as by hue: the tab bar, board card headers, the detail pane, and the
 * always-on count strip in the header. Consistent repetition is the point —
 * it's the one recurring motif that makes the palette read as a system
 * rather than decoration.
 */
const STATUS_PIP = '●';

/** Rows a board card's header + underline rule eat out of its assigned height. */
const CARD_CHROME_ROWS = 2;

/** Digit keys '1'/'2'/'3' <-> the status they pick in the move prompt. */
const STATUS_BY_DIGIT: Readonly<Record<string, TaskStatus>> = {
  '1': 'TODO',
  '2': 'DONE',
  '3': 'CLOSED',
};

/**
 * Move a cursor index up or down one explicit line within a multi-line
 * string, preserving column where possible (clamped to the target line's
 * length) — the same "sticky column" behavior most editors use. Only
 * explicit '\n's count as lines; Ink gives no way to know where a long line
 * soft-wraps on screen, so up/down can't follow visual wrapping.
 */
function moveCursorVertical(text: string, cursor: number, direction: -1 | 1): number {
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
  const col = cursor - lineStart;
  if (direction < 0) {
    if (lineStart === 0) return cursor; // already on the first line
    const prevLineStart = text.lastIndexOf('\n', lineStart - 2) + 1;
    const prevLineEnd = lineStart - 1;
    return prevLineStart + Math.min(col, prevLineEnd - prevLineStart);
  }
  const lineEnd = text.indexOf('\n', cursor);
  if (lineEnd === -1) return cursor; // already on the last line
  const nextLineStart = lineEnd + 1;
  const nextLineEnd = text.indexOf('\n', nextLineStart);
  const nextLineLen = (nextLineEnd === -1 ? text.length : nextLineEnd) - nextLineStart;
  return nextLineStart + Math.min(col, nextLineLen);
}

/** Repeat moveCursorVertical `lines` times (sign gives direction) — used by page up/down. */
function moveCursorByLines(text: string, cursor: number, lines: number): number {
  const direction = lines < 0 ? -1 : 1;
  let pos = cursor;
  for (let i = 0; i < Math.abs(lines); i++) {
    const next = moveCursorVertical(text, pos, direction);
    if (next === pos) break; // hit the first/last line, nothing more to do
    pos = next;
  }
  return pos;
}

// Ink's `useInput` recognizes arrow keys, page up/down, escape, etc. as
// `key.*` booleans, but not Home/End — those keys parse to a name it never
// exposes, so `key` and `input` both come back empty for them. The escape
// sequences below are matched against Ink's raw input chunks instead (see
// the effect below). Every listed variant is a real terminal's encoding of
// Home/End (xterm/vt220 numbered forms included), not a guess — this is
// the same table Ink's own parser uses internally, just without a public
// way to ask it "was that Home?".
const HOME_SEQUENCES = new Set(['[H', 'OH', '[1~', '[7~', '[7$', '[7^']);
const END_SEQUENCES = new Set(['[F', 'OF', '[4~', '[8~', '[8$', '[8^']);

/** The display-only view controls: what's filtered out and how it's ordered. */
export interface ViewOptions {
  query: string;
  priorityFilter: PriorityFilter;
  sortMode: SortMode;
}

/**
 * The visible task list for one status tab. Every step here is a *view* over
 * `doc.tasks` — the document is never mutated, so nothing on this path can
 * reach backlog.md.
 */
export function tasksForTab(doc: BacklogDocument, tab: TaskStatus, view: ViewOptions): Task[] {
  const base =
    view.query.trim().length === 0
      ? doc.tasks.filter((t) => t.status === tab)
      : findTasks(doc, { query: view.query, status: tab, limit: 200 });
  const filtered = base.filter((t) => matchesPriorityFilter(t, view.priorityFilter));
  // Only re-sort when priority order was actually asked for: in 'file' mode a
  // filtered list is in fuzzy-rank order, which is itself meaningful and would
  // be destroyed by sorting. `slice` keeps the sort off the array findTasks or
  // the filter returned.
  return view.sortMode === 'priority' ? filtered.slice().sort(compareByPriority) : filtered;
}

// Fixed-height chrome around the scrolling list — every other row on screen
// — used to work out how many rows are left over for the list itself.
const TITLE_ROWS = 1 + 1 + 1; // wordmark+counts line, path line, hairline rule
// The status tab bar only appears in list mode — board mode already shows
// focus per-card, so the bar would be a redundant extra row there.
const TAB_BAR_ROWS = 1 + 1; // margin above + content
const FILTER_ROWS = 1 + 1;
const LIST_MARGIN_ROWS = 1;
const FOOTER_ROWS = 1 + 1;
const BASE_CHROME_HEIGHT = TITLE_ROWS + FILTER_ROWS + LIST_MARGIN_ROWS + FOOTER_ROWS;

// List view puts the selected task's details in a panel to the right of the
// list. Narrower than this, the two would both be too cramped to read, so the
// list keeps the full width and `enter` opens the full-screen reader instead —
// the same thing board view does, which has no room for a panel at all.
const MIN_PANEL_COLUMNS = 80;
const PANEL_GAP = 1;
/** The panel's border and padding: one column each side for both. */
const PANEL_CHROME_COLUMNS = 4;
const PANEL_CHROME_ROWS = 2;
/** The full-screen reader's footer: margin + one row of key hints. */
const READER_FOOTER_ROWS = 1 + 1;

/** The list's share of a list-view row; the panel takes the rest. */
function listColumnWidth(columns: number): number {
  return Math.min(Math.max(Math.round(columns * 0.4), 30), 60);
}

export function App({ store, backlogPath }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { internal_eventEmitter: internalEventEmitter } = useStdin();
  const [doc, setDoc] = useState<BacklogDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TaskStatus>('TODO');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selected, setSelected] = useState(0);
  const [filterMode, setFilterMode] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
  const [moveCursor, setMoveCursor] = useState(0);
  const [priorityMode, setPriorityMode] = useState(false);
  const [priorityCursor, setPriorityCursor] = useState(0);
  // `enter` on a task: in list view (when the panel fits) it focuses the
  // details panel so the arrows scroll it; otherwise it opens the full-screen
  // reader. Either way, `esc` hands the arrows back to the list.
  const [reading, setReading] = useState(false);
  const [detailScroll, setDetailScroll] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [editCursor, setEditCursor] = useState(0);
  // The task as it stood when editing began. The editor works from this, not
  // `activeTask`: a reload while it's open could put a different task under
  // the cursor, and the save has to be checked against what the draft started from.
  const [editBase, setEditBase] = useState<Task | null>(null);
  const [editNotice, setEditNotice] = useState('');
  // Height of the full-screen description editor's bordered box (see the
  // editMode render branch below) — computed here too so page up/down in
  // the input handler can size a "page" the same way the box is sized. A
  // conflict notice takes two rows (margin + line) away from it.
  const editorHeight = Math.max((stdout.rows || 24) - 6 - (editNotice ? 2 : 0), 3);
  const editorContentRows = Math.max(editorHeight - 2, 1); // minus top/bottom border
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('file');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(undefined);
  const [status, setStatus] = useState<string>('');
  // True while the file is in the pre-rename format and the user hasn't yet
  // said whether to migrate it. Its own screen, not an error: it's answerable.
  const [legacy, setLegacy] = useState(false);
  const [migrating, setMigrating] = useState(false);

  // A legacy file isn't a failure, it's a question — route it to the confirm
  // screen instead of the dead-end error pane. Anything else is a real error.
  const handleError = useCallback((err: unknown) => {
    if (err instanceof LegacyFormatError) setLegacy(true);
    else setError(String(err));
  }, []);

  const reload = useCallback(() => {
    store
      .load()
      .then((d) => setDoc(d))
      .catch(handleError);
  }, [store, handleError]);

  // Migration only renames headings and the Admitted field; the same
  // `migrate: true` path the MCP tools take, behind the same rule that a
  // human has to say yes first.
  const migrateNow = useCallback(() => {
    setMigrating(true);
    store
      .load({ migrate: true })
      .then((d) => {
        setDoc(d);
        setLegacy(false);
        setStatus('backlog migrated to the current format');
      })
      .catch((err: unknown) => setError(String(err)))
      .finally(() => setMigrating(false));
  }, [store]);

  useEffect(reload, [reload]);

  const view: ViewOptions = { query, priorityFilter, sortMode };
  const list = doc ? tasksForTab(doc, tab, view) : [];
  const activeTask = list[selected];

  // A different task starts at its top, not wherever the last one was scrolled.
  useEffect(() => setDetailScroll(0), [activeTask?.id]);

  // Called by the file watcher (below) once backlog.md has settled after a
  // change. Rebuilt every render so it sees the current selection and view;
  // the watcher reaches it through a ref so it isn't torn down and recreated
  // on every keystroke.
  const onDiskChange = useRef<() => void>(() => undefined);
  onDiskChange.current = () => {
    const id = activeTask?.id;
    const previous = selected;
    store
      .load()
      .then((d) => {
        // The TUI's own writes trigger the watcher too, but by then it has
        // already reloaded — same content, so nothing to do or announce.
        if (doc && renderBacklog(d) === renderBacklog(doc)) return;
        setDoc(d);
        if (id === undefined) return;
        const list = tasksForTab(d, tab, view);
        setSelected(selectionAfterChange(list, id, previous));
        // An open move/priority prompt or reader names a task; if that task
        // is gone from view, it would quietly swap to whatever slid under the
        // cursor, and Enter in a prompt would act on that one.
        if ((moveMode || priorityMode || reading) && !list.some((t) => t.id === id)) {
          setMoveMode(false);
          setPriorityMode(false);
          setReading(false);
          setStatus(`#${id} left this view after a change on disk — closed`);
        } else {
          setStatus('reloaded: backlog changed on disk');
        }
      })
      .catch((err: unknown) => {
        // A legacy file is a real state to show. Anything else is most likely
        // a read racing another writer; keep the current view, and the next
        // change (or `r`) will try again.
        if (err instanceof LegacyFormatError) handleError(err);
        else setStatus(`couldn't reload after a change on disk: ${String(err)}`);
      });
  };

  useEffect(() => watchBacklog(store.path, () => onDiskChange.current()), [store]);

  const chromeHeight = BASE_CHROME_HEIGHT + (viewMode === 'list' ? TAB_BAR_ROWS : 0);
  const listHeight = Math.max((stdout.rows || 24) - chromeHeight, 3);
  // Board cards spend a few of their assigned rows on a border and header, so
  // fewer rows are left for items than in the single-column list view.
  const contentHeight =
    viewMode === 'board' ? Math.max(listHeight - CARD_CHROME_ROWS, 1) : listHeight;
  // Keep the selected row inside the visible window, scrolling the minimum
  // amount needed rather than always centering.
  const maxStart = Math.max(0, list.length - contentHeight);
  const visibleStart = Math.min(Math.max(0, selected - contentHeight + 1), maxStart);
  const visible = list.slice(visibleStart, visibleStart + contentHeight);

  const columns = stdout.columns || 80;
  const showPanel = viewMode === 'list' && columns >= MIN_PANEL_COLUMNS;
  const listWidth = showPanel ? listColumnWidth(columns) : columns;
  const panelWidth = columns - listWidth - PANEL_GAP;
  const fullScreenReader = reading && !showPanel;
  // Laid out here, ahead of the input handler, so the scroll keys clamp and
  // page by exactly what's drawn.
  const detail = !activeTask
    ? null
    : fullScreenReader
      ? detailLayout(activeTask, columns - 2, (stdout.rows || 24) - READER_FOOTER_ROWS)
      : showPanel
        ? detailLayout(
            activeTask,
            panelWidth - PANEL_CHROME_COLUMNS,
            listHeight - PANEL_CHROME_ROWS,
          )
        : null;

  /**
   * Reload from disk, keeping the cursor on task `id` if it's still in view
   * (a priority sort may have moved it) or on its old row if not (a move or
   * a filter may have taken it out of this tab).
   */
  const reloadKeeping = useCallback(
    (id: number, previous: number) =>
      store.load().then((d) => {
        setDoc(d);
        setSelected(selectionAfterChange(tasksForTab(d, tab, view), id, previous));
      }),
    [store, tab, query, priorityFilter, sortMode],
  );

  /**
   * Apply a change to the selected task, but only if the task on disk is still
   * the one on screen (see `assertTaskUnchanged`). If it isn't, nothing is
   * written: the TUI reloads and says why, so you act on what's really there.
   */
  const changeTask = useCallback(
    (seen: Task, change: (d: BacklogDocument) => unknown, done: string) => {
      const previous = selected;
      store
        .mutate((d) => {
          assertTaskUnchanged(d, seen);
          change(d);
        })
        .then(() => reloadKeeping(seen.id, previous))
        .then(() => setStatus(done))
        .catch((err: unknown) => {
          if (err instanceof StaleTaskError) {
            setStatus(`#${seen.id} changed on disk — reloaded, nothing saved`);
          } else if (err instanceof TaskNotFoundError) {
            setStatus(`#${seen.id} no longer exists — reloaded`);
          } else {
            handleError(err);
            return;
          }
          reloadKeeping(seen.id, previous).catch(handleError);
        });
    },
    [selected, store, reloadKeeping, handleError],
  );

  const applyMove = useCallback(
    (to: TaskStatus) => {
      if (!activeTask) return;
      const id = activeTask.id;
      setMoveMode(false);
      changeTask(activeTask, (d) => moveTask(d, { id, status: to }), `#${id} -> ${to}`);
    },
    [activeTask, changeTask],
  );

  const applyPriority = useCallback(
    (choice: PriorityChoice) => {
      if (!activeTask) return;
      const id = activeTask.id;
      const priority = choice === 'NONE' ? undefined : choice;
      setPriorityMode(false);
      changeTask(
        activeTask,
        (d) => setTaskPriority(d, { id, priority }),
        `#${id} priority -> ${priority ?? 'none'}`,
      );
    },
    [activeTask, changeTask],
  );

  // Not `changeTask`: when the description changed on disk, reloading would
  // throw away what was typed. The editor stays open with the draft intact,
  // and its base moves to the version on disk, so a second ctrl+s overwrites
  // that version knowingly instead of by accident.
  const saveEdit = useCallback(() => {
    if (!editBase) return;
    const base = editBase;
    const id = base.id;
    const value = editDraft;
    const previous = selected;
    store
      .mutate((d) => {
        assertTaskUnchanged(d, base);
        updateTask(d, { id, field: 'description', value });
      })
      .then(() => {
        setEditMode(false);
        setStatus(`#${id} description updated`);
        return reloadKeeping(id, previous);
      })
      .catch((err: unknown) => {
        if (err instanceof StaleTaskError) {
          setEditBase(err.current);
          setEditNotice(
            `#${id} changed on disk since you started editing. ` +
              'ctrl+s again overwrites it with your draft · esc discards your draft',
          );
        } else if (err instanceof TaskNotFoundError) {
          setEditNotice(`#${id} was deleted on disk, so this can't be saved · esc discards`);
        } else {
          handleError(err);
        }
      });
  }, [editBase, editDraft, selected, store, reloadKeeping, handleError]);

  useInput((input, key) => {
    // The migration confirm owns every key while it's up: nothing else can be
    // done with an unmigrated file anyway, and a stray keystroke must never be
    // what rewrites it.
    if (legacy) {
      if (migrating) return;
      if (input.toLowerCase() === 'y') migrateNow();
      else if (key.escape || input.toLowerCase() === 'q') exit();
      return;
    }

    if (editMode) {
      if (key.escape) {
        setEditMode(false);
        return;
      }
      if (input === 's' && key.ctrl) {
        saveEdit();
        return;
      }
      if (key.leftArrow) {
        setEditCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setEditCursor((c) => Math.min(editDraft.length, c + 1));
        return;
      }
      if (key.upArrow) {
        setEditCursor((c) => moveCursorVertical(editDraft, c, -1));
        return;
      }
      if (key.downArrow) {
        setEditCursor((c) => moveCursorVertical(editDraft, c, 1));
        return;
      }
      if (key.pageUp) {
        setEditCursor((c) => moveCursorByLines(editDraft, c, -editorContentRows));
        return;
      }
      if (key.pageDown) {
        setEditCursor((c) => moveCursorByLines(editDraft, c, editorContentRows));
        return;
      }
      if (key.return) {
        setEditDraft((d) => d.slice(0, editCursor) + '\n' + d.slice(editCursor));
        setEditCursor((c) => c + 1);
        return;
      }
      // Both the Backspace and Delete keys arrive here as `key.delete`
      // (never `key.backspace`) in every terminal we've observed — there is
      // no reliable way to tell them apart, so both delete backward from
      // the cursor, matching Backspace.
      if (key.backspace || key.delete) {
        if (editCursor === 0) return;
        setEditDraft((d) => d.slice(0, editCursor - 1) + d.slice(editCursor));
        setEditCursor((c) => c - 1);
        return;
      }
      if (input) {
        setEditDraft((d) => d.slice(0, editCursor) + input + d.slice(editCursor));
        setEditCursor((c) => c + input.length);
      }
      return;
    }

    if (moveMode) {
      if (key.escape) {
        setMoveMode(false);
        return;
      }
      if (key.leftArrow) {
        setMoveCursor((i) => (i - 1 + STATUS_ORDER.length) % STATUS_ORDER.length);
        return;
      }
      if (key.rightArrow) {
        setMoveCursor((i) => (i + 1) % STATUS_ORDER.length);
        return;
      }
      if (key.return) {
        applyMove(STATUS_ORDER[moveCursor] as TaskStatus);
        return;
      }
      const digitStatus = STATUS_BY_DIGIT[input];
      if (digitStatus) applyMove(digitStatus);
      return;
    }

    if (priorityMode) {
      if (key.escape) {
        setPriorityMode(false);
        return;
      }
      if (key.leftArrow) {
        setPriorityCursor((i) => (i - 1 + PRIORITY_CHOICES.length) % PRIORITY_CHOICES.length);
        return;
      }
      if (key.rightArrow) {
        setPriorityCursor((i) => (i + 1) % PRIORITY_CHOICES.length);
        return;
      }
      if (key.return) {
        applyPriority(PRIORITY_CHOICES[priorityCursor] as PriorityChoice);
        return;
      }
      // Digits pick by position, the same as in the move prompt: 1 = HIGH … 4 = none.
      const digitChoice = PRIORITY_CHOICES[Number(input) - 1];
      if (digitChoice) applyPriority(digitChoice);
      return;
    }

    if (filterMode) {
      if (key.return || key.escape) {
        setFilterMode(false);
        if (key.escape) setQuery('');
        setSelected(0);
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
        return;
      }
      if (input) setQuery((q) => q + input);
      return;
    }

    if (reading) {
      if (key.escape) {
        setReading(false);
        return;
      }
      const max = detail?.maxScroll ?? 0;
      const page = detail?.bodyRows ?? 1;
      // Clamp before adding too: a window resize can leave `s` past the new max.
      const scrollBy = (n: number) =>
        setDetailScroll((s) => Math.max(0, Math.min(Math.min(s, max) + n, max)));
      if (input === 'k' || key.upArrow) {
        scrollBy(-1);
        return;
      }
      if (input === 'j' || key.downArrow) {
        scrollBy(1);
        return;
      }
      if (key.pageUp) {
        scrollBy(-page);
        return;
      }
      if (key.pageDown || input === ' ') {
        scrollBy(page);
        return;
      }
      if (input === 'g') {
        setDetailScroll(0);
        return;
      }
      if (input === 'G') {
        setDetailScroll(max);
        return;
      }
      // The move and priority prompts live above the list; the full-screen
      // reader covers it, so step back out to where the prompt can be seen.
      if ((input === 'm' || input === 'P') && fullScreenReader) setReading(false);
      // These act on the task being read, through the shared handlers below.
      // Everything else (switching tabs, filtering…) belongs to the list.
      const passThrough = ['e', 'm', 'P', 'q'].includes(input) || (input === 'c' && key.ctrl);
      if (!passThrough) return;
    }

    if (input === 'q' || (input === 'c' && key.ctrl)) {
      exit();
      return;
    }
    if (input === '/') {
      setFilterMode(true);
      return;
    }
    if (key.return && activeTask) {
      setReading(true);
      return;
    }
    if (input === '1') {
      setTab('TODO');
      setSelected(0);
      return;
    }
    if (input === '2') {
      setTab('DONE');
      setSelected(0);
      return;
    }
    if (input === '3') {
      setTab('CLOSED');
      setSelected(0);
      return;
    }
    if (key.tab) {
      setViewMode((m) => (m === 'list' ? 'board' : 'list'));
      return;
    }
    if (key.rightArrow) {
      setTab(
        (t) => STATUS_ORDER[(STATUS_ORDER.indexOf(t) + 1) % STATUS_ORDER.length] as TaskStatus,
      );
      setSelected(0);
      return;
    }
    if (key.leftArrow) {
      setTab(
        (t) =>
          STATUS_ORDER[
            (STATUS_ORDER.indexOf(t) - 1 + STATUS_ORDER.length) % STATUS_ORDER.length
          ] as TaskStatus,
      );
      setSelected(0);
      return;
    }
    if (input === 'j' || key.downArrow) {
      setSelected((i) => Math.min(i + 1, Math.max(list.length - 1, 0)));
      return;
    }
    if (input === 'k' || key.upArrow) {
      setSelected((i) => Math.max(i - 1, 0));
      return;
    }
    // Both of these are view state only — they never touch the store, so the
    // file on disk is identical before and after. Selection resets to the top
    // because the row under the cursor usually isn't the same row afterward.
    if (input === 's') {
      const next: SortMode = sortMode === 'file' ? 'priority' : 'file';
      setSortMode(next);
      setSelected(0);
      setStatus(next === 'priority' ? 'sorted by priority (view only)' : 'sorted by file order');
      return;
    }
    if (input === 'p') {
      const next =
        PRIORITY_FILTER_CYCLE[
          (PRIORITY_FILTER_CYCLE.indexOf(priorityFilter) + 1) % PRIORITY_FILTER_CYCLE.length
        ];
      setPriorityFilter(next);
      setSelected(0);
      setStatus(`priority filter: ${priorityFilterLabel(next)}`);
      return;
    }
    if (input === 'r') {
      reload();
      setStatus('reloaded');
      return;
    }
    if (input === 'm' && activeTask) {
      setMoveCursor(STATUS_ORDER.indexOf(activeTask.status));
      setMoveMode(true);
      return;
    }
    // Shift+p: `p` alone is the display-only filter; setting a priority writes
    // to backlog.md, so it gets the shifted key and a confirm step.
    if (input === 'P' && activeTask) {
      setPriorityCursor(PRIORITY_CHOICES.indexOf(activeTask.priority ?? 'NONE'));
      setPriorityMode(true);
      return;
    }
    if (input === 'e' && activeTask) {
      setEditBase(activeTask);
      setEditNotice('');
      setEditDraft(activeTask.description);
      setEditCursor(activeTask.description.length);
      setEditMode(true);
      return;
    }
  });

  // Home/End land here rather than in useInput above because Ink's `key`
  // object has no field for them (see HOME_SEQUENCES/END_SEQUENCES) — so
  // this reads the raw escape sequence off Ink's own internal 'input' event
  // instead. That's deliberately not `stdin.on('data', ...)`: Ink consumes
  // stdin itself via `stdin.read()` in paused mode, and attaching a 'data'
  // listener would flip the stream to flowing mode and silently steal bytes
  // from Ink's own parsing. `internal_eventEmitter` re-broadcasts the same
  // raw chunks Ink reads, without touching the stream's mode.
  useEffect(() => {
    if (!editMode) return;
    const onInput = (chunk: string) => {
      if (!chunk.startsWith('\u001B')) return;
      const rest = chunk.slice(1);
      if (HOME_SEQUENCES.has(rest)) {
        setEditCursor((c) => editDraft.lastIndexOf('\n', c - 1) + 1);
      } else if (END_SEQUENCES.has(rest)) {
        setEditCursor((c) => {
          const lineEnd = editDraft.indexOf('\n', c);
          return lineEnd === -1 ? editDraft.length : lineEnd;
        });
      }
    };
    internalEventEmitter?.on('input', onInput);
    return () => {
      internalEventEmitter?.off('input', onInput);
    };
  }, [editMode, editDraft, internalEventEmitter]);

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  // Spelled out rather than summarized: the user is being asked to approve a
  // rewrite of the file, so they get to see exactly what it does first.
  if (legacy) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={THEME.accent}>▍</Text>
          <Text bold> DrBacklog</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{backlogPath}</Text>
        </Box>
        <Box marginTop={1}>
          <Text>This backlog is in the old pre-rename format.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Migrating renames the section headings</Text>
          <Text dimColor> CRITICAL → TODO · STABLE → DONE · ARCHIVED → CLOSED</Text>
          <Text dimColor>the Patient Ledger heading to Task Details, and the per-task</Text>
          <Text dimColor>Admitted field to Created. The old default H1 is replaced;</Text>
          <Text dimColor>a title you chose yourself is left alone, as is every task.</Text>
        </Box>
        <Box marginTop={1}>
          {migrating ? (
            <Text color={THEME.accent}>Migrating…</Text>
          ) : (
            <>
              <Text color={THEME.accent}>y</Text>
              <Text dimColor> migrate now · </Text>
              <Text color={THEME.accent}>esc/q</Text>
              <Text dimColor> quit and leave the file alone</Text>
            </>
          )}
        </Box>
      </Box>
    );
  }

  if (!doc) {
    return <Text>Loading {backlogPath}...</Text>;
  }

  // Full-screen mode, same idea as swapping list<->board: editing a
  // description needs room to grow, so it claims the whole frame instead of
  // squeezing into the details panel.
  if (editMode && editBase) {
    // Overlay the cursor on the character already there (like a real
    // terminal cursor) instead of inserting an extra glyph — inserting one
    // shoves the rest of the line sideways as the cursor moves through it.
    // At end-of-text or right before a newline there's no character to
    // stand on, so a blank cell (width 0 consumed from the string) fills in.
    const atCursor = editDraft[editCursor];
    const cursorStandsOnCharacter = atCursor !== undefined && atCursor !== '\n';
    const cursorGlyph = cursorStandsOnCharacter ? atCursor : ' ';
    const cursorGlyphWidth = cursorStandsOnCharacter ? 1 : 0;
    return (
      <Box key="edit-screen" flexDirection="column" width={stdout.columns} height={stdout.rows}>
        <Box width={stdout.columns} justifyContent="space-between">
          <Box>
            <Text color={THEME.accent}>▍</Text>
            <Text bold> Editing #{editBase.id} </Text>
            <Text dimColor>{editBase.title}</Text>
          </Box>
          <Box>
            <Text color={THEME.status[editBase.status]}>
              {STATUS_PIP} {editBase.status}
            </Text>
          </Box>
        </Box>
        <Box
          width={stdout.columns}
          borderStyle="single"
          borderTop={false}
          borderLeft={false}
          borderRight={false}
          borderBottomColor={THEME.rule}
          borderBottomDimColor
        />
        <Box
          marginTop={1}
          flexDirection="column"
          height={editorHeight}
          borderStyle="single"
          borderColor={THEME.accent}
          paddingX={1}
        >
          <Text>
            {editDraft.slice(0, editCursor)}
            <Text inverse>{cursorGlyph}</Text>
            {editDraft.slice(editCursor + cursorGlyphWidth)}
          </Text>
        </Box>
        {editNotice && (
          <Box marginTop={1}>
            <Text color={THEME.priority.MEDIUM}>▍ </Text>
            <Text>{editNotice}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={THEME.accent}>↑↓←→</Text>
          <Text dimColor> move · </Text>
          <Text color={THEME.accent}>home/end</Text>
          <Text dimColor> line · </Text>
          <Text color={THEME.accent}>pgup/pgdn</Text>
          <Text dimColor> page · </Text>
          <Text color={THEME.accent}>ctrl+s</Text>
          <Text dimColor> save · </Text>
          <Text color={THEME.accent}>esc</Text>
          <Text dimColor> discard</Text>
        </Box>
      </Box>
    );
  }

  // Board view's (and a narrow terminal's) answer to the side panel: the task
  // gets the whole frame, the same way the description editor does.
  if (fullScreenReader && activeTask && detail) {
    return (
      <Box key="reader-screen" flexDirection="column" width={columns} height={stdout.rows}>
        <Box flexDirection="column" paddingX={1}>
          <DetailView task={activeTask} layout={detail} scroll={detailScroll} />
        </Box>
        <Box marginTop={1}>
          <Text color={THEME.accent}>↑↓ j/k</Text>
          <Text dimColor> scroll · </Text>
          <Text color={THEME.accent}>pgup/pgdn</Text>
          <Text dimColor> page · </Text>
          <Text color={THEME.accent}>e</Text>
          <Text dimColor> edit · </Text>
          <Text color={THEME.accent}>m/P</Text>
          <Text dimColor> move/priority · </Text>
          <Text color={THEME.accent}>esc</Text>
          <Text dimColor> back</Text>
          {status && <Text dimColor> ▏ {status}</Text>}
        </Box>
      </Box>
    );
  }

  /** One board card. The focused column reuses the live-scrolling `visible` window; the other two just clip to what fits, since they have no selection to follow. */
  function renderCard(s: TaskStatus): React.ReactElement {
    const focused = s === tab;
    const items = focused ? visible : tasksForTab(doc!, s, view).slice(0, contentHeight);
    const start = focused ? visibleStart : 0;
    // The unfocused columns' counts respect the same filters as their contents,
    // so "+N more" never promises rows the filter has already removed.
    const total = focused ? list.length : tasksForTab(doc!, s, view).length;
    return (
      <Box
        key={s}
        flexDirection="column"
        flexGrow={1}
        flexBasis={0}
        marginRight={s === 'CLOSED' ? 0 : 2}
        height={listHeight}
      >
        <Box
          borderStyle="single"
          borderTop={false}
          borderLeft={false}
          borderRight={false}
          borderBottomColor={focused ? THEME.accent : THEME.rule}
          borderBottomDimColor={!focused}
        >
          <Text color={THEME.status[s]}>{STATUS_PIP} </Text>
          <Text bold underline={focused} color={THEME.status[s]}>
            {s}
          </Text>
          <Text dimColor> ({total})</Text>
        </Box>
        {items.length === 0 && <Text dimColor> —</Text>}
        {items.map((task, i) => {
          const isSelected = focused && start + i === selected;
          return (
            <Box key={task.id}>
              <Text color={isSelected ? THEME.accent : undefined}>{isSelected ? '▏ ' : '  '}</Text>
              <Text dimColor={!isSelected}>#{task.id} </Text>
              <Text bold={isSelected} color={isSelected ? THEME.accent : undefined}>
                {task.title}
              </Text>
              <PriorityMark priority={task.priority} />
            </Box>
          );
        })}
        {total > start + items.length && (
          <Text dimColor> +{total - start - items.length} more</Text>
        )}
      </Box>
    );
  }

  // While the panel has focus only its keys do anything, so only they're shown.
  const shortcuts: ReadonlyArray<readonly [string, string]> = reading
    ? [
        ['↑↓ j/k', 'scroll'],
        ['pgup/pgdn', 'page'],
        ['g/G', 'top/bottom'],
        ['e', 'edit description'],
        ['m', 'move task'],
        ['P', 'set priority'],
        ['esc', 'back to list'],
      ]
    : [
        ['←/→ 1/2/3', 'switch list'],
        ['j/k', 'move'],
        ['enter', 'read'],
        ['tab', viewMode === 'list' ? 'board view' : 'list view'],
        ['/', 'filter'],
        ['s', sortMode === 'file' ? 'sort by priority' : 'sort by file order'],
        ['p', `priority: ${priorityFilterLabel(priorityFilter)}`],
        ['m', 'move task'],
        ['P', 'set priority'],
        ['e', 'edit description'],
        ['r', 'reload'],
        ['q', 'quit'],
      ];

  return (
    <Box key="main-screen" flexDirection="column" width={stdout.columns} height={stdout.rows}>
      <Box width={stdout.columns} justifyContent="space-between">
        <Box>
          <Text color={THEME.accent}>▍</Text>
          <Text bold> DrBacklog</Text>
        </Box>
        <Box>
          {STATUS_ORDER.map((s, i) => (
            <Box key={s} marginLeft={i === 0 ? 0 : 2}>
              <Text color={THEME.status[s]}>{STATUS_PIP} </Text>
              <Text dimColor>{doc.tasks.filter((t) => t.status === s).length}</Text>
            </Box>
          ))}
        </Box>
      </Box>
      <Box>
        <Text dimColor>{backlogPath}</Text>
      </Box>
      <Box
        width={stdout.columns}
        borderStyle="single"
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        borderBottomColor={THEME.rule}
        borderBottomDimColor
      />
      {viewMode === 'list' && (
        <Box marginTop={1}>
          {STATUS_ORDER.map((s, i) => (
            <Box key={s} marginRight={i < STATUS_ORDER.length - 1 ? 3 : 0}>
              <Text color={THEME.status[s]}>{STATUS_PIP} </Text>
              <Text bold={s === tab} underline={s === tab} color={THEME.status[s]}>
                {s}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        {moveMode && activeTask ? (
          <Box>
            <Text color={THEME.accent}>Move </Text>
            <Text bold>#{activeTask.id}</Text>
            <Text color={THEME.accent}> to </Text>
            {STATUS_ORDER.map((s, i) => (
              <Text
                key={s}
                bold={i === moveCursor}
                underline={i === moveCursor}
                color={i === moveCursor ? THEME.accent : THEME.status[s]}
              >
                {'  '}
                {s}
                {'  '}
              </Text>
            ))}
            <Text dimColor> ←/→ pick · enter confirm · esc cancel</Text>
          </Box>
        ) : priorityMode && activeTask ? (
          <Box>
            <Text color={THEME.accent}>Priority for </Text>
            <Text bold>#{activeTask.id}</Text>
            <Text color={THEME.accent}> → </Text>
            {PRIORITY_CHOICES.map((c, i) => (
              <Text
                key={c}
                bold={i === priorityCursor}
                underline={i === priorityCursor}
                color={
                  i === priorityCursor ? THEME.accent : c === 'NONE' ? undefined : THEME.priority[c]
                }
                dimColor={c === 'NONE' && i !== priorityCursor}
              >
                {'  '}
                {c === 'NONE' ? 'none' : `${c} ${priorityFor(c).marker}`}
                {'  '}
              </Text>
            ))}
            <Text dimColor> ←/→ pick · enter confirm · esc cancel</Text>
          </Box>
        ) : (
          <Box>
            <Text dimColor>Filter </Text>
            <Text color={filterMode ? THEME.accent : undefined}>{query || '—'}</Text>
            {filterMode && <Text color={THEME.accent}>▏</Text>}
            {/* Only shown once they're doing something: a line reading
                "sort file · priority all" on every screen would be noise. */}
            {sortMode === 'priority' && (
              <>
                <Text dimColor> · sort </Text>
                <Text color={THEME.accent}>priority</Text>
              </>
            )}
            {priorityFilter !== undefined && (
              <>
                <Text dimColor> · priority </Text>
                <Text
                  color={priorityFilter === 'NONE' ? THEME.accent : THEME.priority[priorityFilter]}
                >
                  {priorityFilterLabel(priorityFilter)}
                </Text>
              </>
            )}
          </Box>
        )}
      </Box>
      {viewMode === 'board' ? (
        <Box marginTop={1} flexDirection="row" flexGrow={1} height={listHeight}>
          {STATUS_ORDER.map((s) => renderCard(s))}
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="row" flexGrow={1} height={listHeight}>
          <Box flexDirection="column" width={listWidth} height={listHeight}>
            {list.length === 0 && (
              <Text dimColor>
                {query.trim()
                  ? `No matches for “${query}”.`
                  : priorityFilter !== undefined
                    ? // Naming the filter matters here: without it an empty list
                      // reads as "this tab is empty" when really it's hidden.
                      `Nothing in ${tab.toLowerCase()} at ${priorityFilterLabel(priorityFilter)} priority.`
                    : `Nothing in ${tab.toLowerCase()} yet.`}
              </Text>
            )}
            {visible.map((task, i) => {
              const isSelected = visibleStart + i === selected;
              // One row per task, cut off at the column edge rather than
              // wrapped: the scroll window counts rows, and the full title is
              // in the panel anyway.
              return (
                <Text key={task.id} wrap="truncate-end">
                  <Text color={isSelected ? THEME.accent : undefined}>
                    {isSelected ? '▏ ' : '  '}
                  </Text>
                  <Text dimColor={!isSelected}>#{task.id} </Text>
                  <Text bold={isSelected} color={isSelected ? THEME.accent : undefined}>
                    {task.title}
                  </Text>
                  <PriorityMark priority={task.priority} />
                </Text>
              );
            })}
            {maxStart > 0 && (
              <Text dimColor>
                [{visibleStart + 1}-{Math.min(visibleStart + contentHeight, list.length)} of{' '}
                {list.length}]
              </Text>
            )}
          </Box>
          {showPanel && (
            <Box
              flexDirection="column"
              marginLeft={PANEL_GAP}
              width={panelWidth}
              height={listHeight}
              borderStyle="round"
              borderColor={reading ? THEME.accent : THEME.rule}
              borderDimColor={!reading}
              paddingX={1}
            >
              {activeTask && detail ? (
                <DetailView task={activeTask} layout={detail} scroll={detailScroll} />
              ) : (
                <Text dimColor>Nothing selected</Text>
              )}
            </Box>
          )}
        </Box>
      )}
      <Box marginTop={1} flexWrap="wrap">
        {shortcuts.map(([key, label]) => (
          <Box key={key} marginRight={2}>
            <Text color={THEME.accent}>{key}</Text>
            <Text dimColor> {label}</Text>
          </Box>
        ))}
        {status && (
          <Box>
            <Text color={THEME.accent}>▏ </Text>
            <Text dimColor>{status}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
