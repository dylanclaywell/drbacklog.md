// Tests for the TUI's display-only view logic: how the visible list is
// filtered and ordered. These helpers are pure functions over a
// BacklogDocument, so they're tested directly rather than through a rendered
// Ink tree. The central guarantee is that none of this mutates the document —
// sorting and filtering in the TUI must never reach backlog.md.

import { describe, expect, it } from 'vitest';

import {
  matchesPriorityFilter,
  PRIORITY_CHOICES,
  PRIORITY_FILTER_CYCLE,
  priorityFilterLabel,
  selectionAfterChange,
  tasksForTab,
  type PriorityFilter,
  type ViewOptions,
} from './app.js';
import { addTask } from '../operations.js';
import { createEmptyDocument } from '../store.js';
import type { BacklogDocument, Task, TaskPriority } from '../model.js';

/** Four TODO tasks added out of rank order, one deliberately untriaged. */
function seededDoc(): BacklogDocument {
  const doc = createEmptyDocument();
  const add = (title: string, priority?: TaskPriority) =>
    addTask(doc, { title, description: '', created: '2026-07-17', priority });
  add('low one', 'LOW');
  add('untriaged one');
  add('high one', 'HIGH');
  add('medium one', 'MEDIUM');
  return doc;
}

function view(overrides: Partial<ViewOptions> = {}): ViewOptions {
  return { query: '', priorityFilter: undefined, sortMode: 'file', ...overrides };
}

const titles = (tasks: Task[]): string[] => tasks.map((t) => t.title);

describe('priorityFilterLabel', () => {
  it('names the all and untriaged pseudo-levels readably', () => {
    expect(priorityFilterLabel(undefined)).toBe('all');
    expect(priorityFilterLabel('NONE')).toBe('untriaged');
    expect(priorityFilterLabel('HIGH')).toBe('HIGH');
  });
});

describe('PRIORITY_FILTER_CYCLE', () => {
  it('steps all -> each level, most urgent first -> untriaged, then wraps', () => {
    expect(PRIORITY_FILTER_CYCLE).toEqual([undefined, 'HIGH', 'MEDIUM', 'LOW', 'NONE']);
  });

  it('returns to "all" after a full cycle', () => {
    let filter: PriorityFilter = undefined;
    for (let i = 0; i < PRIORITY_FILTER_CYCLE.length; i++) {
      filter =
        PRIORITY_FILTER_CYCLE[
          (PRIORITY_FILTER_CYCLE.indexOf(filter) + 1) % PRIORITY_FILTER_CYCLE.length
        ];
    }
    expect(filter).toBeUndefined();
  });
});

describe('matchesPriorityFilter', () => {
  const task = (priority?: TaskPriority): Task => ({
    id: 1,
    title: 't',
    description: '',
    status: 'TODO',
    created: '',
    extraLines: [],
    ...(priority === undefined ? {} : { priority }),
  });

  it('passes everything when no filter is set', () => {
    expect(matchesPriorityFilter(task('HIGH'), undefined)).toBe(true);
    expect(matchesPriorityFilter(task(), undefined)).toBe(true);
  });

  it('matches a specific level exactly', () => {
    expect(matchesPriorityFilter(task('HIGH'), 'HIGH')).toBe(true);
    expect(matchesPriorityFilter(task('LOW'), 'HIGH')).toBe(false);
  });

  it("'NONE' selects untriaged tasks, which no real level can", () => {
    expect(matchesPriorityFilter(task(), 'NONE')).toBe(true);
    expect(matchesPriorityFilter(task('MEDIUM'), 'NONE')).toBe(false);
  });
});

describe('PRIORITY_CHOICES', () => {
  it('offers each level, most urgent first, then a way to clear it', () => {
    expect(PRIORITY_CHOICES).toEqual(['HIGH', 'MEDIUM', 'LOW', 'NONE']);
  });
});

describe('selectionAfterChange', () => {
  it('follows the task to its new row when a priority sort moved it', () => {
    const doc = seededDoc();
    doc.tasks.find((t) => t.title === 'low one')!.priority = 'HIGH';
    const list = tasksForTab(doc, 'TODO', view({ sortMode: 'priority' }));
    // 'low one' was row 2 under priority sort; now HIGH, it ties 'high one'
    // and keeps file order, so it sorts to the top.
    expect(selectionAfterChange(list, 1, 2)).toBe(0);
  });

  it('stays on the same row when a filter hid the task', () => {
    const doc = seededDoc();
    doc.tasks.find((t) => t.title === 'untriaged one')!.priority = 'LOW';
    const list = tasksForTab(doc, 'TODO', view({ priorityFilter: 'NONE' }));
    expect(list).toEqual([]);
    expect(selectionAfterChange(list, 2, 0)).toBe(0);
  });

  it('clamps to the last row when the hidden task was at the bottom', () => {
    const doc = seededDoc();
    const list = tasksForTab(doc, 'TODO', view()).slice(0, 3);
    expect(selectionAfterChange(list, 99, 3)).toBe(2);
  });
});

describe('tasksForTab', () => {
  it('keeps document order by default', () => {
    expect(titles(tasksForTab(seededDoc(), 'TODO', view()))).toEqual([
      'low one',
      'untriaged one',
      'high one',
      'medium one',
    ]);
  });

  it('orders by priority when asked, untriaged last', () => {
    expect(titles(tasksForTab(seededDoc(), 'TODO', view({ sortMode: 'priority' })))).toEqual([
      'high one',
      'medium one',
      'low one',
      'untriaged one',
    ]);
  });

  it('narrows to one level', () => {
    expect(titles(tasksForTab(seededDoc(), 'TODO', view({ priorityFilter: 'HIGH' })))).toEqual([
      'high one',
    ]);
  });

  it('shows only untriaged tasks under the NONE filter', () => {
    expect(titles(tasksForTab(seededDoc(), 'TODO', view({ priorityFilter: 'NONE' })))).toEqual([
      'untriaged one',
    ]);
  });

  it('combines the fuzzy query with a priority filter', () => {
    const doc = createEmptyDocument();
    addTask(doc, { title: 'login bug', description: '', created: '', priority: 'HIGH' });
    addTask(doc, { title: 'login polish', description: '', created: '', priority: 'LOW' });
    addTask(doc, { title: 'unrelated', description: '', created: '', priority: 'HIGH' });

    const result = tasksForTab(doc, 'TODO', view({ query: 'login', priorityFilter: 'HIGH' }));
    expect(titles(result)).toEqual(['login bug']);
  });

  it('leaves fuzzy rank order alone in file mode', () => {
    const doc = createEmptyDocument();
    // The weaker match is added first, so document order and rank order differ.
    addTask(doc, { title: 'unrelated thing with a login mention', description: '', created: '' });
    addTask(doc, { title: 'login', description: '', created: '' });

    const result = tasksForTab(doc, 'TODO', view({ query: 'login' }));
    expect(result[0]!.title).toBe('login');
  });

  it('only returns tasks in the requested status tab', () => {
    const doc = seededDoc();
    doc.tasks[0]!.status = 'DONE';
    expect(titles(tasksForTab(doc, 'DONE', view()))).toEqual(['low one']);
  });

  it('never mutates the document, whatever the sort or filter', () => {
    const doc = seededDoc();
    const before = doc.tasks.map((t) => t.id);
    tasksForTab(doc, 'TODO', view({ sortMode: 'priority' }));
    tasksForTab(doc, 'TODO', view({ sortMode: 'priority', priorityFilter: 'HIGH' }));
    tasksForTab(doc, 'TODO', view({ sortMode: 'priority', query: 'one' }));
    expect(doc.tasks.map((t) => t.id)).toEqual(before);
  });
});
