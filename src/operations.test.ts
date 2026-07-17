import { describe, expect, it } from 'vitest';

import { addTask, nextId } from './operations.js';
import { createEmptyDocument } from './store.js';

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
