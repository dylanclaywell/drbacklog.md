// Pure operations over a BacklogDocument.
//
// Every function here mutates or reads the in-memory model and is free of I/O,
// so it can be unit-tested directly. The MCP layer wires these to the store and
// wraps them with input validation and plain result strings.

import type { BacklogDocument, Epic, Task, TaskStatus } from './model.js';

/** Thrown when an operation references a task id that is not in the backlog. */
export class TaskNotFoundError extends Error {
  constructor(public readonly id: number) {
    super(`No task with id ${id}`);
    this.name = 'TaskNotFoundError';
  }
}

/** Thrown when an operation references an epic id that is not in the backlog. */
export class EpicNotFoundError extends Error {
  constructor(public readonly id: number) {
    super(`No epic with id ${id}`);
    this.name = 'EpicNotFoundError';
  }
}

/** Find a task by id or throw TaskNotFoundError. */
function findTaskOrThrow(doc: BacklogDocument, id: number): Task {
  const task = doc.tasks.find((t) => t.id === id);
  if (!task) throw new TaskNotFoundError(id);
  return task;
}

/** Find an epic by id or throw EpicNotFoundError. */
function findEpicOrThrow(doc: BacklogDocument, id: number): Epic {
  const epic = doc.epics.find((e) => e.id === id);
  if (!epic) throw new EpicNotFoundError(id);
  return epic;
}

/** The next task id: one past the highest existing id (1 for an empty backlog). */
export function nextId(doc: BacklogDocument): number {
  return doc.tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1;
}

export interface AddTaskInput {
  title: string;
  description: string;
  /** Creation date, `YYYY-MM-DD`, supplied by the caller's clock. */
  created: string;
}

/** Add a new task to the TODO section and return it. */
export function addTask(doc: BacklogDocument, input: AddTaskInput): Task {
  const task: Task = {
    id: nextId(doc),
    title: input.title,
    description: input.description,
    status: 'TODO',
    created: input.created,
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

/** Move a task to a new status, optionally recording a resolution. */
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

/** Look up a task by id, or undefined if there is no such task. */
export function getTask(doc: BacklogDocument, id: number): Task | undefined {
  return doc.tasks.find((t) => t.id === id);
}

export type ExportFormat = 'csv' | 'json';

export interface ExportResult {
  filename: string;
  content: string;
}

interface ExportRow {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  created: string;
  resolution: string;
}

const CSV_COLUMNS: readonly (keyof ExportRow)[] = [
  'id',
  'title',
  'description',
  'status',
  'created',
  'resolution',
];

/** Flatten a task to a export row; internal extraLines are omitted. */
function toRow(task: Task): ExportRow {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    created: task.created,
    resolution: task.resolution ?? '',
  };
}

/** Quote a CSV field when it contains a comma, quote, or newline. */
function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: ExportRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((col) => csvEscape(String(row[col]))).join(','));
  }
  return lines.join('\n') + '\n';
}

/** Serialize the backlog for external tools (e.g. Jira import) as CSV or JSON. */
export function exportBacklog(doc: BacklogDocument, format: ExportFormat): ExportResult {
  const rows = doc.tasks.map(toRow);
  if (format === 'json') {
    return { filename: 'backlog.json', content: JSON.stringify(rows, null, 2) + '\n' };
  }
  return { filename: 'backlog.csv', content: toCsv(rows) };
}

// --- Epics ---------------------------------------------------------------
//
// Epics are an opt-in grouping of tasks: a document with none never grows an
// Epics section (see render.ts). An epic has no lifecycle of its own — see
// findEpicOrThrow above for lookup, and Epic in model.ts for the shape.

/** The next epic id: one past the highest existing id (1 for no epics). */
export function nextEpicId(doc: BacklogDocument): number {
  return doc.epics.reduce((max, epic) => Math.max(max, epic.id), 0) + 1;
}

export interface AddEpicInput {
  title: string;
  description: string;
}

/** Add a new epic and return it. */
export function addEpic(doc: BacklogDocument, input: AddEpicInput): Epic {
  const epic: Epic = {
    id: nextEpicId(doc),
    title: input.title,
    description: input.description,
    extraLines: [],
  };
  doc.epics.push(epic);
  return epic;
}

export interface UpdateEpicInput {
  id: number;
  field: 'title' | 'description';
  value: string;
}

/** Update a single text field on an epic. */
export function updateEpic(doc: BacklogDocument, input: UpdateEpicInput): Epic {
  const epic = findEpicOrThrow(doc, input.id);
  epic[input.field] = input.value;
  return epic;
}

/**
 * Remove an epic and return it. Any tasks linked to it are unlinked
 * (`epicId` cleared) rather than left pointing at a dangling id.
 */
export function removeEpic(doc: BacklogDocument, id: number): Epic {
  const epic = findEpicOrThrow(doc, id);
  doc.epics = doc.epics.filter((e) => e.id !== id);
  for (const task of doc.tasks) {
    if (task.epicId === id) task.epicId = undefined;
  }
  return epic;
}

/** Look up an epic by id, or undefined if there is no such epic. */
export function getEpic(doc: BacklogDocument, id: number): Epic | undefined {
  return doc.epics.find((e) => e.id === id);
}

/** All epics, in the order they were created. */
export function listEpics(doc: BacklogDocument): Epic[] {
  return doc.epics;
}

/** All tasks currently linked to the given epic. */
export function getEpicTasks(doc: BacklogDocument, epicId: number): Task[] {
  return doc.tasks.filter((t) => t.epicId === epicId);
}

export interface SetTaskEpicInput {
  id: number;
  /** The epic to link the task to; omit to unlink the task from any epic. */
  epicId?: number;
}

/**
 * Link a task to an epic, or unlink it (when `epicId` is omitted). Throws
 * TaskNotFoundError / EpicNotFoundError if either id doesn't exist.
 */
export function setTaskEpic(doc: BacklogDocument, input: SetTaskEpicInput): Task {
  const task = findTaskOrThrow(doc, input.id);
  if (input.epicId !== undefined) findEpicOrThrow(doc, input.epicId);
  task.epicId = input.epicId;
  return task;
}
