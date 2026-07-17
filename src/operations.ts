// Pure operations over a BacklogDocument.
//
// Every function here mutates or reads the in-memory model and is free of I/O,
// so it can be unit-tested directly. The MCP layer wires these to the store and
// wraps them with input validation and themed result strings.

import type { BacklogDocument, Task, TaskStatus } from './model.js';

/** Thrown when an operation references a task id that is not in the backlog. */
export class TaskNotFoundError extends Error {
  constructor(public readonly id: number) {
    super(`No task with id ${id}`);
    this.name = 'TaskNotFoundError';
  }
}

/** Find a task by id or throw TaskNotFoundError. */
function findTaskOrThrow(doc: BacklogDocument, id: number): Task {
  const task = doc.tasks.find((t) => t.id === id);
  if (!task) throw new TaskNotFoundError(id);
  return task;
}

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

export interface MoveTaskInput {
  id: number;
  status: TaskStatus;
  /** Optional resolution note; recorded only when moving to DONE or CLOSED. */
  resolution?: string;
}

/** Move a task to a new ward, optionally recording a resolution. */
export function moveTask(doc: BacklogDocument, input: MoveTaskInput): Task {
  const task = findTaskOrThrow(doc, input.id);
  task.status = input.status;
  if ((input.status === 'DONE' || input.status === 'CLOSED') && input.resolution !== undefined) {
    task.resolution = input.resolution;
  }
  return task;
}

export interface UpdateTaskInput {
  id: number;
  field: 'title' | 'description' | 'resolution';
  value: string;
}

/**
 * Update a single text field on a task. Titles need no anchor rework: index
 * anchors derive from the id, so the renderer stays consistent automatically.
 */
export function updateTask(doc: BacklogDocument, input: UpdateTaskInput): Task {
  const task = findTaskOrThrow(doc, input.id);
  switch (input.field) {
    case 'title':
      task.title = input.value;
      break;
    case 'description':
      task.description = input.value;
      break;
    case 'resolution':
      task.resolution = input.value;
      break;
  }
  return task;
}

/**
 * Remove a task from the backlog entirely and return it. Note: nextId is
 * highest-id + 1, so deleting the highest-id task frees that id for reuse.
 */
export function removeTask(doc: BacklogDocument, id: number): Task {
  const task = findTaskOrThrow(doc, id);
  doc.tasks = doc.tasks.filter((t) => t.id !== id);
  return task;
}
