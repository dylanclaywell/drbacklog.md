// Root TUI component: a three-tab task list (TODO/DONE/CLOSED) with a fuzzy
// filter and a detail pane, plus a couple of mutating keybindings that go
// through the same `operations.ts` functions the MCP tools call — so TUI
// behavior never diverges from tool behavior.

import { Box, Text, useApp, useInput, useStdout } from 'ink';
import React, { useCallback, useEffect, useState } from 'react';

import { findTasks, moveTask, updateTask } from '../operations.js';
import type { BacklogDocument, Task, TaskStatus } from '../model.js';
import { SECTIONS } from '../model.js';
import type { BacklogStore } from '../store.js';

export interface AppProps {
  store: BacklogStore;
  backlogPath: string;
}

const STATUS_ORDER: readonly TaskStatus[] = SECTIONS.map((s) => s.status);

/** 'list' shows one status at a time; 'board' shows all three as side-by-side cards. */
type ViewMode = 'list' | 'board';

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
} as const;

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

function tasksForTab(doc: BacklogDocument, tab: TaskStatus, query: string): Task[] {
  if (query.trim().length === 0) {
    return doc.tasks.filter((t) => t.status === tab);
  }
  return findTasks(doc, { query, status: tab, limit: 200 });
}

// Fixed-height chrome around the scrolling list — every other row on screen
// — used to work out how many rows are left over for the list itself.
const DETAIL_PANE_HEIGHT = 6;
const TITLE_ROWS = 1 + 1 + 1; // wordmark+counts line, path line, hairline rule
// The status tab bar only appears in list mode — board mode already shows
// focus per-card, so the bar would be a redundant extra row there.
const TAB_BAR_ROWS = 1 + 1; // margin above + content
const FILTER_ROWS = 1 + 1;
const LIST_MARGIN_ROWS = 1;
const DETAIL_MARGIN_ROWS = 1;
const FOOTER_ROWS = 1 + 1;
const BASE_CHROME_HEIGHT =
  TITLE_ROWS +
  FILTER_ROWS +
  LIST_MARGIN_ROWS +
  DETAIL_MARGIN_ROWS +
  DETAIL_PANE_HEIGHT +
  FOOTER_ROWS;

export function App({ store, backlogPath }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [doc, setDoc] = useState<BacklogDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TaskStatus>('TODO');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selected, setSelected] = useState(0);
  const [filterMode, setFilterMode] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
  const [moveCursor, setMoveCursor] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [editCursor, setEditCursor] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string>('');

  const reload = useCallback(() => {
    store
      .load()
      .then((d) => setDoc(d))
      .catch((err: unknown) => setError(String(err)));
  }, [store]);

  useEffect(reload, [reload]);

  const list = doc ? tasksForTab(doc, tab, query) : [];
  const activeTask = list[selected];

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

  const applyMove = useCallback(
    (to: TaskStatus) => {
      if (!activeTask) return;
      const id = activeTask.id;
      setMoveMode(false);
      store
        .mutate((d) => moveTask(d, { id, status: to }))
        .then(() => {
          setStatus(`#${id} -> ${to}`);
          reload();
        })
        .catch((err: unknown) => setError(String(err)));
    },
    [activeTask, store, reload],
  );

  const saveEdit = useCallback(() => {
    if (!activeTask) return;
    const id = activeTask.id;
    const value = editDraft;
    setEditMode(false);
    store
      .mutate((d) => updateTask(d, { id, field: 'description', value }))
      .then(() => {
        setStatus(`#${id} description updated`);
        reload();
      })
      .catch((err: unknown) => setError(String(err)));
  }, [activeTask, editDraft, store, reload]);

  useInput((input, key) => {
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

    if (input === 'q' || (input === 'c' && key.ctrl)) {
      exit();
      return;
    }
    if (input === '/') {
      setFilterMode(true);
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
    if (input === 'e' && activeTask) {
      setEditDraft(activeTask.description);
      setEditCursor(activeTask.description.length);
      setEditMode(true);
      return;
    }
  });

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  if (!doc) {
    return <Text>Loading {backlogPath}...</Text>;
  }

  // Full-screen mode, same idea as swapping list<->board: editing a
  // description needs room to grow, so it claims the whole frame instead of
  // squeezing into the fixed-height detail pane.
  if (editMode && activeTask) {
    const editorHeight = Math.max((stdout.rows || 24) - 6, 3);
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
            <Text bold> Editing #{activeTask.id} </Text>
            <Text dimColor>{activeTask.title}</Text>
          </Box>
          <Box>
            <Text color={THEME.status[activeTask.status]}>
              {STATUS_PIP} {activeTask.status}
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
        <Box marginTop={1}>
          <Text color={THEME.accent}>↑↓←→</Text>
          <Text dimColor> move · </Text>
          <Text color={THEME.accent}>ctrl+s</Text>
          <Text dimColor> save · </Text>
          <Text color={THEME.accent}>esc</Text>
          <Text dimColor> discard</Text>
        </Box>
      </Box>
    );
  }

  /** One board card. The focused column reuses the live-scrolling `visible` window; the other two just clip to what fits, since they have no selection to follow. */
  function renderCard(s: TaskStatus): React.ReactElement {
    const focused = s === tab;
    const items = focused ? visible : tasksForTab(doc!, s, query).slice(0, contentHeight);
    const start = focused ? visibleStart : 0;
    const total = focused ? list.length : doc!.tasks.filter((t) => t.status === s).length;
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
            </Box>
          );
        })}
        {total > start + items.length && (
          <Text dimColor> +{total - start - items.length} more</Text>
        )}
      </Box>
    );
  }

  const shortcuts: ReadonlyArray<readonly [string, string]> = [
    ['←/→ 1/2/3', 'switch list'],
    ['j/k', 'move'],
    ['tab', viewMode === 'list' ? 'board view' : 'list view'],
    ['/', 'filter'],
    ['m', 'move task'],
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
        ) : (
          <Box>
            <Text dimColor>Filter </Text>
            <Text color={filterMode ? THEME.accent : undefined}>{query || '—'}</Text>
            {filterMode && <Text color={THEME.accent}>▏</Text>}
          </Box>
        )}
      </Box>
      {viewMode === 'board' ? (
        <Box marginTop={1} flexDirection="row" flexGrow={1} height={listHeight}>
          {STATUS_ORDER.map((s) => renderCard(s))}
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column" flexGrow={1} height={listHeight}>
          {list.length === 0 && (
            <Text dimColor>
              {query.trim() ? `No matches for “${query}”.` : `Nothing in ${tab.toLowerCase()} yet.`}
            </Text>
          )}
          {visible.map((task, i) => {
            const isSelected = visibleStart + i === selected;
            return (
              <Box key={task.id}>
                <Text color={isSelected ? THEME.accent : undefined}>
                  {isSelected ? '▏ ' : '  '}
                </Text>
                <Text dimColor={!isSelected}>#{task.id} </Text>
                <Text bold={isSelected} color={isSelected ? THEME.accent : undefined}>
                  {task.title}
                </Text>
              </Box>
            );
          })}
          {maxStart > 0 && (
            <Text dimColor>
              [{visibleStart + 1}-{Math.min(visibleStart + contentHeight, list.length)} of{' '}
              {list.length}]
            </Text>
          )}
        </Box>
      )}
      <Box
        marginTop={1}
        flexDirection="column"
        borderStyle="single"
        borderTop={false}
        borderRight={false}
        borderBottom={false}
        borderLeftColor={THEME.accent}
        paddingLeft={1}
        height={DETAIL_PANE_HEIGHT}
      >
        {activeTask ? (
          <>
            <Text bold>
              #{activeTask.id} {activeTask.title}
            </Text>
            <Box>
              <Text color={THEME.status[activeTask.status]}>
                {STATUS_PIP} {activeTask.status}
              </Text>
              <Text dimColor> · created {activeTask.created}</Text>
              {activeTask.epicId !== undefined && (
                <Text dimColor> · epic #{activeTask.epicId}</Text>
              )}
            </Box>
            <Text>{activeTask.description || '—'}</Text>
            {activeTask.resolution && <Text dimColor>Resolution: {activeTask.resolution}</Text>}
          </>
        ) : (
          <Text dimColor>Nothing selected</Text>
        )}
      </Box>
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
