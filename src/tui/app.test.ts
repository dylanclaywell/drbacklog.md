// Tests for the TUI's display-only view logic: how the visible list is
// filtered and ordered. These helpers are pure functions over a
// BacklogDocument, so they're tested directly rather than through a rendered
// Ink tree. The central guarantee is that none of this mutates the document —
// sorting and filtering in the TUI must never reach backlog.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertTaskUnchanged,
  detailLayout,
  matchesPriorityFilter,
  PRIORITY_CHOICES,
  PRIORITY_FILTER_CYCLE,
  priorityFilterLabel,
  sameTask,
  selectionAfterChange,
  StaleTaskError,
  tasksForTab,
  wrapText,
  type PriorityFilter,
  type ViewOptions,
} from './app.js';
import {
  addTask,
  moveTask,
  removeTask,
  setTaskPriority,
  TaskNotFoundError,
  updateTask,
} from '../operations.js';
import { BacklogStore, createEmptyDocument } from '../store.js';
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

describe('wrapText', () => {
  it('breaks prose at word boundaries within the width', () => {
    expect(wrapText('the quick brown fox jumps over', 10)).toEqual([
      'the quick',
      'brown fox',
      'jumps over',
    ]);
  });

  it('keeps paragraphs and the blank lines between them', () => {
    expect(wrapText('first\n\nsecond', 20)).toEqual(['first', '', 'second']);
  });

  it('hangs a list item’s wrapped lines under its text', () => {
    expect(wrapText('- one two three four', 10)).toEqual(['- one two', '  three', '  four']);
    expect(wrapText('12. alpha beta gamma', 12)).toEqual(['12. alpha', '    beta', '    gamma']);
  });

  it('splits a word too long for any line', () => {
    expect(wrapText('see https://example.com/a/long/path', 12)).toEqual([
      'see',
      'https://exam',
      'ple.com/a/lo',
      'ng/path',
    ]);
  });

  it('cuts code at the edge without reflowing it', () => {
    const fenced = '```\nif (x)   {  y();  }\n```';
    expect(wrapText(fenced, 10)).toEqual(['```', 'if (x)   {', '  y();  }', '```']);
    expect(wrapText('    keep   this   spacing', 40)).toEqual(['    keep   this   spacing']);
  });

  it('never returns a line longer than the width', () => {
    const text = 'a markdown description\n- with a list item that runs long\n\nand more prose';
    for (const width of [1, 5, 13, 40]) {
      for (const line of wrapText(text, width)) expect(line.length).toBeLessThanOrEqual(width);
    }
  });
});

describe('detailLayout', () => {
  const task = (overrides: Partial<Task> = {}): Task => ({
    id: 7,
    title: 'Fix login',
    description: Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'),
    status: 'TODO',
    created: '2026-10-20',
    extraLines: [],
    ...overrides,
  });

  it('gives the body whatever the title, status line, blank and hint rows leave', () => {
    const layout = detailLayout(task(), 40, 10);
    expect(layout.titleLines).toEqual(['#7 Fix login']);
    expect(layout.bodyRows).toBe(10 - 1 - 2 - 1);
    expect(layout.maxScroll).toBe(20 - layout.bodyRows);
  });

  it('takes a wrapped title’s extra rows out of the body', () => {
    const layout = detailLayout(task({ title: 'a title long enough to wrap twice' }), 16, 10);
    expect(layout.titleLines.length).toBe(3);
    expect(layout.bodyRows).toBe(10 - 3 - 2 - 1);
  });

  it('does not scroll a body that fits', () => {
    expect(detailLayout(task({ description: 'short' }), 40, 10).maxScroll).toBe(0);
  });

  it('appends the resolution after a blank line and marks where it starts', () => {
    const layout = detailLayout(task({ description: 'done it', resolution: 'shipped' }), 40, 10);
    expect(layout.bodyLines).toEqual(['done it', '', 'Resolution: shipped']);
    expect(layout.resolutionStart).toBe(1);
  });
});

describe('sameTask', () => {
  const base = (): Task => seededDoc().tasks[0]!;

  it('treats an identical task as unchanged', () => {
    expect(sameTask(base(), base())).toBe(true);
  });

  it('notices a change to any field, including the optional ones', () => {
    const changed: Array<(t: Task) => void> = [
      (t) => (t.title = 'other'),
      (t) => (t.description = 'other'),
      (t) => (t.status = 'DONE'),
      (t) => (t.created = '2026-01-01'),
      (t) => (t.resolution = 'shipped'),
      (t) => (t.epicId = 1),
      (t) => delete t.priority,
      (t) => t.extraLines.push('* **Owner:** someone'),
    ];
    for (const change of changed) {
      const t = base();
      change(t);
      expect(sameTask(base(), t)).toBe(false);
    }
  });
});

// Two stores on one file stand in for the TUI and the MCP server: separate
// processes, each holding its own BacklogStore, so neither one's lock covers
// the other — exactly the situation the guard exists for.
describe('assertTaskUnchanged against a file changed elsewhere', () => {
  let dir: string;
  let file: string;
  let tui: BacklogStore;
  let agent: BacklogStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drbacklog-tui-'));
    file = join(dir, 'backlog.md');
    tui = new BacklogStore(file);
    agent = new BacklogStore(file);
    await agent.mutate((d) => {
      addTask(d, { title: 'first', description: 'original', created: '2026-10-20' });
      addTask(d, { title: 'second', description: '', created: '2026-10-20' });
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** What the TUI is showing for task `id`, as of its last load. */
  async function seen(id: number): Promise<Task> {
    return (await tui.load()).tasks.find((t) => t.id === id)!;
  }

  it('lets the change through when the task is as the TUI saw it', async () => {
    const task = await seen(1);
    // An unrelated change elsewhere in the file doesn't block it.
    await agent.mutate((d) => setTaskPriority(d, { id: 2, priority: 'LOW' }));

    await tui.mutate((d) => {
      assertTaskUnchanged(d, task);
      moveTask(d, { id: 1, status: 'DONE' });
    });

    const after = await agent.load();
    expect(after.tasks.find((t) => t.id === 1)!.status).toBe('DONE');
    expect(after.tasks.find((t) => t.id === 2)!.priority).toBe('LOW');
  });

  it("refuses a description save that would overwrite someone else's edit", async () => {
    const task = await seen(1);
    await agent.mutate((d) => updateTask(d, { id: 1, field: 'description', value: 'theirs' }));
    const before = await readFile(file, 'utf8');

    const save = tui.mutate((d) => {
      assertTaskUnchanged(d, task);
      updateTask(d, { id: 1, field: 'description', value: 'mine' });
    });

    const err = await save.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleTaskError);
    // It carries the version on disk, so the editor can rebase onto it.
    expect((err as StaleTaskError).current.description).toBe('theirs');
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('refuses a change to an id that now belongs to a different task', async () => {
    const task = await seen(2);
    // nextId is highest + 1, so deleting #2 and adding a task reuses its id.
    await agent.mutate((d) => {
      removeTask(d, 2);
      addTask(d, { title: 'someone else', description: '', created: '2026-10-20' });
    });

    const move = tui.mutate((d) => {
      assertTaskUnchanged(d, task);
      moveTask(d, { id: 2, status: 'CLOSED' });
    });

    await expect(move).rejects.toBeInstanceOf(StaleTaskError);
    expect((await agent.load()).tasks.find((t) => t.id === 2)!.status).toBe('TODO');
  });

  it('reports a task deleted elsewhere as not found', async () => {
    const task = await seen(1);
    await agent.mutate((d) => removeTask(d, 1));

    const move = tui.mutate((d) => {
      assertTaskUnchanged(d, task);
      moveTask(d, { id: 1, status: 'DONE' });
    });

    await expect(move).rejects.toBeInstanceOf(TaskNotFoundError);
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
