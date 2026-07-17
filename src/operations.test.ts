import { describe, expect, it } from 'vitest';

import {
  addTask,
  moveTask,
  nextId,
  removeTask,
  TaskNotFoundError,
  updateTask,
} from './operations.js';
import { createEmptyDocument } from './store.js';

function docWithTask(): { doc: ReturnType<typeof createEmptyDocument>; id: number } {
  const doc = createEmptyDocument();
  const task = addTask(doc, { title: 'A task', description: 'desc', admitted: '2026-07-17' });
  return { doc, id: task.id };
}

describe('nextId', () => {
  it('starts at 1 for an empty backlog', () => {
    expect(nextId(createEmptyDocument())).toBe(1);
  });

  it('returns one past the highest existing id, ignoring gaps', () => {
    const doc = createEmptyDocument();
    doc.tasks.push(
      { id: 1, title: 'a', description: '', status: 'TODO', admitted: '', extraLines: [] },
      { id: 5, title: 'b', description: '', status: 'DONE', admitted: '', extraLines: [] },
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
      admitted: '2026-07-17',
    });

    expect(task).toEqual({
      id: 1,
      title: 'Implement login',
      description: 'OAuth2 flow.',
      status: 'TODO',
      admitted: '2026-07-17',
      extraLines: [],
    });
    expect(doc.tasks).toHaveLength(1);
    expect(doc.tasks[0]).toBe(task);
  });

  it('assigns incrementing ids across successive adds', () => {
    const doc = createEmptyDocument();
    const first = addTask(doc, { title: 'a', description: '', admitted: '2026-07-17' });
    const second = addTask(doc, { title: 'b', description: '', admitted: '2026-07-17' });
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
    const a = addTask(doc, { title: 'a', description: '', admitted: '2026-07-17' });
    const b = addTask(doc, { title: 'b', description: '', admitted: '2026-07-17' });
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
    addTask(doc, { title: 'a', description: '', admitted: '2026-07-17' });
    const b = addTask(doc, { title: 'b', description: '', admitted: '2026-07-17' });
    expect(b.id).toBe(2);
    removeTask(doc, b.id);
    expect(nextId(doc)).toBe(2);
  });
});
