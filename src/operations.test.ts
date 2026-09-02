import { describe, expect, it } from 'vitest';

import {
  addEpic,
  addTask,
  EpicNotFoundError,
  exportBacklog,
  findTasks,
  getEpic,
  getEpicTasks,
  getTask,
  listEpics,
  moveTask,
  nextEpicId,
  nextId,
  removeEpic,
  removeTask,
  setTaskEpic,
  TaskNotFoundError,
  updateEpic,
  updateTask,
} from './operations.js';
import { createEmptyDocument } from './store.js';

function docWithTask(): { doc: ReturnType<typeof createEmptyDocument>; id: number } {
  const doc = createEmptyDocument();
  const task = addTask(doc, { title: 'A task', description: 'desc', created: '2026-07-17' });
  return { doc, id: task.id };
}

describe('nextId', () => {
  it('starts at 1 for an empty backlog', () => {
    expect(nextId(createEmptyDocument())).toBe(1);
  });

  it('returns one past the highest existing id, ignoring gaps', () => {
    const doc = createEmptyDocument();
    doc.tasks.push(
      { id: 1, title: 'a', description: '', status: 'TODO', created: '', extraLines: [] },
      { id: 5, title: 'b', description: '', status: 'DONE', created: '', extraLines: [] },
    );
    expect(nextId(doc)).toBe(6);
  });
});

describe('addTask', () => {
  it('adds a TODO task with the next id and the given fields', () => {
    const doc = createEmptyDocument();
    const task = addTask(doc, {
      title: 'Implement login',
      description: 'OAuth2 flow.',
      created: '2026-07-17',
    });

    expect(task).toEqual({
      id: 1,
      title: 'Implement login',
      description: 'OAuth2 flow.',
      status: 'TODO',
      created: '2026-07-17',
      extraLines: [],
    });
    expect(doc.tasks).toHaveLength(1);
    expect(doc.tasks[0]).toBe(task);
  });

  it('assigns incrementing ids across successive adds', () => {
    const doc = createEmptyDocument();
    const first = addTask(doc, { title: 'a', description: '', created: '2026-07-17' });
    const second = addTask(doc, { title: 'b', description: '', created: '2026-07-17' });
    expect([first.id, second.id]).toEqual([1, 2]);
  });
});

describe('moveTask', () => {
  it('records a resolution when moving to DONE', () => {
    const { doc, id } = docWithTask();
    const task = moveTask(doc, { id, status: 'DONE', resolution: 'Shipped it.' });
    expect(task.status).toBe('DONE');
    expect(task.resolution).toBe('Shipped it.');
  });

  it('records a resolution when moving to CLOSED', () => {
    const { doc, id } = docWithTask();
    const task = moveTask(doc, { id, status: 'CLOSED', resolution: 'Not doing this.' });
    expect(task.status).toBe('CLOSED');
    expect(task.resolution).toBe('Not doing this.');
  });

  it('moves without a resolution when none is provided', () => {
    const { doc, id } = docWithTask();
    const task = moveTask(doc, { id, status: 'DONE' });
    expect(task.status).toBe('DONE');
    expect(task.resolution).toBeUndefined();
  });

  it('ignores a resolution when moving back to TODO', () => {
    const { doc, id } = docWithTask();
    const task = moveTask(doc, { id, status: 'TODO', resolution: 'ignored' });
    expect(task.status).toBe('TODO');
    expect(task.resolution).toBeUndefined();
  });

  it('throws TaskNotFoundError for an unknown id', () => {
    const doc = createEmptyDocument();
    expect(() => moveTask(doc, { id: 999, status: 'DONE' })).toThrow(TaskNotFoundError);
  });
});

describe('updateTask', () => {
  it('updates the title without touching other fields', () => {
    const { doc, id } = docWithTask();
    const task = updateTask(doc, { id, field: 'title', value: 'New title' });
    expect(task.title).toBe('New title');
    expect(task.description).toBe('desc');
    expect(task.id).toBe(id);
  });

  it('updates the description', () => {
    const { doc, id } = docWithTask();
    const task = updateTask(doc, { id, field: 'description', value: 'New description' });
    expect(task.description).toBe('New description');
  });

  it('sets the resolution on a task that had none', () => {
    const { doc, id } = docWithTask();
    const task = updateTask(doc, { id, field: 'resolution', value: 'Fixed it.' });
    expect(task.resolution).toBe('Fixed it.');
  });

  it('throws TaskNotFoundError for an unknown id', () => {
    const doc = createEmptyDocument();
    expect(() => updateTask(doc, { id: 999, field: 'title', value: 'x' })).toThrow(
      TaskNotFoundError,
    );
  });
});

describe('removeTask', () => {
  it('removes the task and returns it, leaving others intact', () => {
    const doc = createEmptyDocument();
    const a = addTask(doc, { title: 'a', description: '', created: '2026-07-17' });
    const b = addTask(doc, { title: 'b', description: '', created: '2026-07-17' });
    const removed = removeTask(doc, a.id);
    expect(removed).toBe(a);
    expect(doc.tasks.map((t) => t.id)).toEqual([b.id]);
  });

  it('throws TaskNotFoundError for an unknown id', () => {
    const doc = createEmptyDocument();
    expect(() => removeTask(doc, 999)).toThrow(TaskNotFoundError);
  });

  it('frees the highest id for reuse by nextId', () => {
    const doc = createEmptyDocument();
    addTask(doc, { title: 'a', description: '', created: '2026-07-17' });
    const b = addTask(doc, { title: 'b', description: '', created: '2026-07-17' });
    expect(b.id).toBe(2);
    removeTask(doc, b.id);
    expect(nextId(doc)).toBe(2);
  });
});

describe('getTask', () => {
  it('returns the matching task', () => {
    const { doc, id } = docWithTask();
    expect(getTask(doc, id)?.id).toBe(id);
  });

  it('returns undefined for an unknown id', () => {
    expect(getTask(createEmptyDocument(), 999)).toBeUndefined();
  });
});

describe('findTasks', () => {
  it('ranks a title match above an unrelated task', () => {
    const doc = createEmptyDocument();
    addTask(doc, { title: 'Implement OAuth login', description: 'Google + GitHub.', created: 'x' });
    addTask(doc, { title: 'Fix CSS bug', description: 'Button alignment.', created: 'x' });

    const results = findTasks(doc, { query: 'oauth' });
    expect(results.map((t) => t.id)).toEqual([1]);
  });

  it('matches on description when the title does not match', () => {
    const doc = createEmptyDocument();
    addTask(doc, {
      title: 'Fix bug',
      description: 'Related to OAuth token refresh.',
      created: 'x',
    });

    expect(findTasks(doc, { query: 'oauth' }).map((t) => t.id)).toEqual([1]);
  });

  it('filters by status', () => {
    const doc = createEmptyDocument();
    addTask(doc, { title: 'Login page', description: '', created: 'x' });
    const task2 = addTask(doc, { title: 'Login retry', description: '', created: 'x' });
    task2.status = 'DONE';

    expect(findTasks(doc, { query: 'login', status: 'DONE' }).map((t) => t.id)).toEqual([2]);
  });

  it('filters by epicId', () => {
    const doc = createEmptyDocument();
    const task1 = addTask(doc, { title: 'Login page', description: '', created: 'x' });
    addTask(doc, { title: 'Login retry', description: '', created: 'x' });
    const epic = addEpic(doc, { title: 'Auth', description: '' });
    task1.epicId = epic.id;

    expect(findTasks(doc, { query: 'login', epicId: epic.id }).map((t) => t.id)).toEqual([1]);
  });

  it('respects limit', () => {
    const doc = createEmptyDocument();
    for (let i = 0; i < 5; i++)
      addTask(doc, { title: `Login task ${i}`, description: '', created: 'x' });

    expect(findTasks(doc, { query: 'login', limit: 2 })).toHaveLength(2);
  });

  it('excludes tasks with no match in title or description', () => {
    const doc = createEmptyDocument();
    addTask(doc, { title: 'Fix CSS bug', description: 'Button alignment.', created: 'x' });

    expect(findTasks(doc, { query: 'zzz' })).toEqual([]);
  });
});

describe('exportBacklog', () => {
  it('serializes tasks to JSON with a backlog.json filename', () => {
    const doc = createEmptyDocument();
    addTask(doc, { title: 'Login', description: 'OAuth2.', created: '2026-07-17' });
    const { filename, content } = exportBacklog(doc, 'json');
    expect(filename).toBe('backlog.json');
    const parsed = JSON.parse(content) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: 1,
      title: 'Login',
      description: 'OAuth2.',
      status: 'TODO',
      created: '2026-07-17',
      resolution: '',
    });
  });

  it('serializes tasks to CSV with a header and one row per task', () => {
    const doc = createEmptyDocument();
    addTask(doc, { title: 'Login', description: 'OAuth2.', created: '2026-07-17' });
    const { filename, content } = exportBacklog(doc, 'csv');
    expect(filename).toBe('backlog.csv');
    const lines = content.trimEnd().split('\n');
    expect(lines[0]).toBe('id,title,description,status,created,resolution');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('1,Login,OAuth2.,TODO,2026-07-17,');
  });

  it('escapes CSV fields containing commas, quotes, and newlines', () => {
    const doc = createEmptyDocument();
    addTask(doc, {
      title: 'has, comma "and" quote',
      description: 'line one\nline two',
      created: '2026-07-17',
    });
    const { content } = exportBacklog(doc, 'csv');
    expect(content).toContain('"has, comma ""and"" quote"');
    expect(content).toContain('"line one\nline two"');
  });

  it('exports an empty backlog as an empty JSON array', () => {
    expect(exportBacklog(createEmptyDocument(), 'json').content).toBe('[]\n');
  });
});

describe('epics', () => {
  function docWithEpic(): { doc: ReturnType<typeof createEmptyDocument>; id: number } {
    const doc = createEmptyDocument();
    const epic = addEpic(doc, { title: 'Auth overhaul', description: 'Replace sessions.' });
    return { doc, id: epic.id };
  }

  describe('nextEpicId', () => {
    it('starts at 1 for no epics', () => {
      expect(nextEpicId(createEmptyDocument())).toBe(1);
    });

    it('returns one past the highest existing id', () => {
      const { doc } = docWithEpic();
      expect(nextEpicId(doc)).toBe(2);
    });
  });

  describe('addEpic', () => {
    it('adds an epic with the next id and given fields', () => {
      const doc = createEmptyDocument();
      const epic = addEpic(doc, { title: 'Auth overhaul', description: 'Replace sessions.' });
      expect(epic).toEqual({
        id: 1,
        title: 'Auth overhaul',
        description: 'Replace sessions.',
        extraLines: [],
      });
      expect(doc.epics).toEqual([epic]);
    });
  });

  describe('updateEpic', () => {
    it('updates the requested field only', () => {
      const { doc, id } = docWithEpic();
      const epic = updateEpic(doc, { id, field: 'title', value: 'Auth revamp' });
      expect(epic.title).toBe('Auth revamp');
      expect(epic.description).toBe('Replace sessions.');
    });

    it('throws EpicNotFoundError for an unknown id', () => {
      const doc = createEmptyDocument();
      expect(() => updateEpic(doc, { id: 999, field: 'title', value: 'x' })).toThrow(
        EpicNotFoundError,
      );
    });
  });

  describe('removeEpic', () => {
    it('removes the epic and unlinks any tasks pointing at it', () => {
      const { doc, id } = docWithEpic();
      const task = addTask(doc, { title: 'a', description: '', created: '2026-07-17' });
      setTaskEpic(doc, { id: task.id, epicId: id });

      const removed = removeEpic(doc, id);
      expect(removed.id).toBe(id);
      expect(doc.epics).toEqual([]);
      expect(getTask(doc, task.id)?.epicId).toBeUndefined();
    });

    it('throws EpicNotFoundError for an unknown id', () => {
      const doc = createEmptyDocument();
      expect(() => removeEpic(doc, 999)).toThrow(EpicNotFoundError);
    });
  });

  describe('getEpic / listEpics', () => {
    it('finds an epic by id, and lists all epics', () => {
      const { doc, id } = docWithEpic();
      expect(getEpic(doc, id)?.id).toBe(id);
      expect(getEpic(doc, 999)).toBeUndefined();
      expect(listEpics(doc)).toEqual(doc.epics);
    });
  });

  describe('setTaskEpic / getEpicTasks', () => {
    it('links a task to an epic, then unlinks it', () => {
      const { doc, id } = docWithEpic();
      const task = addTask(doc, { title: 'a', description: '', created: '2026-07-17' });

      setTaskEpic(doc, { id: task.id, epicId: id });
      expect(getTask(doc, task.id)?.epicId).toBe(id);
      expect(getEpicTasks(doc, id)).toEqual([getTask(doc, task.id)]);

      setTaskEpic(doc, { id: task.id });
      expect(getTask(doc, task.id)?.epicId).toBeUndefined();
      expect(getEpicTasks(doc, id)).toEqual([]);
    });

    it('throws TaskNotFoundError for an unknown task id', () => {
      const { doc, id } = docWithEpic();
      expect(() => setTaskEpic(doc, { id: 999, epicId: id })).toThrow(TaskNotFoundError);
    });

    it('throws EpicNotFoundError for an unknown epic id', () => {
      const doc = createEmptyDocument();
      const task = addTask(doc, { title: 'a', description: '', created: '2026-07-17' });
      expect(() => setTaskEpic(doc, { id: task.id, epicId: 999 })).toThrow(EpicNotFoundError);
    });
  });
});
