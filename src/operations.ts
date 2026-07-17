// Pure operations over a BacklogDocument.
//
// Every function here mutates or reads the in-memory model and is free of I/O,
// so it can be unit-tested directly. The MCP layer wires these to the store and
// wraps them with input validation and themed result strings.

import type { BacklogDocument, Task } from './model.js';

/** The next task id: one past the highest existing id (1 for an empty backlog). */
export function nextId(doc: BacklogDocument): number {
  return doc.tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1;
}

export interface AddTaskInput {
  title: string;
  description: string;
  /** Admission date, `YYYY-MM-DD`, supplied by the caller's clock. */
  admitted: string;
}

/** Add a new task to the TODO ward and return it. */
export function addTask(doc: BacklogDocument, input: AddTaskInput): Task {
  const task: Task = {
    id: nextId(doc),
    title: input.title,
    description: input.description,
    status: 'TODO',
    admitted: input.admitted,
    extraLines: [],
  };
  doc.tasks.push(task);
  return task;
}
