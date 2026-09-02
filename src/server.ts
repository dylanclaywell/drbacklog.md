// MCP server wiring: registers the DrBacklog tools against a BacklogStore.
//
// Tool names and result strings are plain and conventional. Mutations go
// through store.mutate so they are serialized and persisted atomically; reads
// use store.load.

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  addEpic,
  addTask,
  EpicNotFoundError,
  exportBacklog,
  getEpic,
  getEpicTasks,
  getTask,
  listEpics,
  moveTask,
  removeEpic,
  removeTask,
  setTaskEpic,
  TaskNotFoundError,
  updateEpic,
  updateTask,
} from './operations.js';
import { renderSummary } from './render.js';
import { LegacyFormatError, type BacklogStore, type LoadOptions } from './store.js';
import type { Epic, Task } from './model.js';

const idSchema = z.coerce.number().int().positive();

// Every tool takes this: the file is only migrated from the pre-rename format
// when a caller passes migrate: true, so an old file is never rewritten
// without an explicit, per-call opt-in (see LegacyFormatError below).
const migrateSchema = z
  .boolean()
  .optional()
  .describe(
    'Set true to migrate backlog.md from the old pre-rename format before running this tool. ' +
      'Only set this after the user has confirmed migrating is OK.',
  );

interface CreateServerOptions {
  /** Directory to write export files into (trusted; filenames are fixed). */
  exportDir: string;
}

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function errorText(body: string) {
  return { content: [{ type: 'text' as const, text: body }], isError: true };
}

function notFound(id: number) {
  return errorText(`No task #${id} found.`);
}

function notFoundEpic(id: number) {
  return errorText(`No epic #${id} found.`);
}

function legacyFormat() {
  return errorText(
    'backlog.md is in the old pre-rename format (CRITICAL/STABLE/ARCHIVED headings, ' +
      '"Admitted" field) and needs a one-time migration before this can run. Migration only ' +
      'renames headings and the Admitted field to Created — no tasks are changed. Confirm ' +
      'with the user that migrating now is OK, then retry this exact call with migrate: true.',
  );
}

/** Run a tool body, translating known store/operation errors to a text result. */
async function guarded(fn: () => Promise<ReturnType<typeof text>>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LegacyFormatError) return legacyFormat();
    throw err;
  }
}

/** Today's date as YYYY-MM-DD from the server clock. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTaskDetail(task: Task): string {
  const lines = [
    `Task #${task.id}:`,
    `* Status: ${task.status}`,
    `* Created: ${task.created}`,
    `* Title: ${task.title}`,
    `* Description: ${task.description}`,
  ];
  if (task.epicId !== undefined) lines.push(`* Epic: #${task.epicId}`);
  if (task.resolution !== undefined) lines.push(`* Resolution: ${task.resolution}`);
  return lines.join('\n');
}

function formatEpicDetail(epic: Epic): string {
  return [`Epic #${epic.id}: ${epic.title}`, `* Description: ${epic.description}`].join('\n');
}

function formatEpicList(epics: Epic[]): string {
  if (epics.length === 0) return 'No epics.';
  return epics.map((epic) => `- #${epic.id}: ${epic.title}`).join('\n');
}

function formatEpicTaskList(epicId: number, tasks: Task[]): string {
  if (tasks.length === 0) return `No tasks linked to epic #${epicId}.`;
  return tasks
    .map((task) => `- [#${task.id}: ${task.title}](#task-${task.id}) — ${task.status}`)
    .join('\n');
}

export function createServer(store: BacklogStore, options: CreateServerOptions): McpServer {
  const server = new McpServer({ name: 'drbacklog', version: '0.1.0' });

  server.registerTool(
    'add_task',
    {
      title: 'Add a task',
      description: 'Add a new task to the backlog. New tasks start with status TODO.',
      inputSchema: {
        title: z.string().min(1),
        description: z.string(),
        migrate: migrateSchema,
      },
    },
    async ({ title, description, migrate }) =>
      guarded(async () => {
        const loadOptions: LoadOptions = { migrate };
        const task = await store.mutate(
          (doc) => addTask(doc, { title, description, created: today() }),
          loadOptions,
        );
        return text(`Created task #${task.id}.`);
      }),
  );

  server.registerTool(
    'move_task',
    {
      title: "Change a task's status",
      description:
        'Move a task to a new status: TODO, DONE, or CLOSED. Optionally record a resolution note (applied when DONE or CLOSED).',
      inputSchema: {
        id: idSchema,
        status: z.enum(['TODO', 'DONE', 'CLOSED']),
        resolution: z.string().optional(),
        migrate: migrateSchema,
      },
    },
    async ({ id, status, resolution, migrate }) =>
      guarded(async () => {
        try {
          await store.mutate((doc) => moveTask(doc, { id, status, resolution }), { migrate });
          return text(`Task #${id} moved to ${status}.`);
        } catch (err) {
          if (err instanceof TaskNotFoundError) return notFound(id);
          throw err;
        }
      }),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update a task field',
      description: "Edit a task's title, description, or resolution.",
      inputSchema: {
        id: idSchema,
        field: z.enum(['title', 'description', 'resolution']),
        value: z.string(),
        migrate: migrateSchema,
      },
    },
    async ({ id, field, value, migrate }) =>
      guarded(async () => {
        try {
          await store.mutate((doc) => updateTask(doc, { id, field, value }), { migrate });
          return text(`Task #${id}'s ${field} updated.`);
        } catch (err) {
          if (err instanceof TaskNotFoundError) return notFound(id);
          throw err;
        }
      }),
  );

  server.registerTool(
    'remove_task',
    {
      title: 'Delete a task',
      description: 'Permanently remove a task from the backlog.',
      inputSchema: { id: idSchema, migrate: migrateSchema },
    },
    async ({ id, migrate }) =>
      guarded(async () => {
        try {
          await store.mutate((doc) => removeTask(doc, id), { migrate });
          return text(`Task #${id} removed.`);
        } catch (err) {
          if (err instanceof TaskNotFoundError) return notFound(id);
          throw err;
        }
      }),
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get a task',
      description: "Retrieve a single task's full details by id.",
      inputSchema: { id: idSchema, migrate: migrateSchema },
    },
    async ({ id, migrate }) =>
      guarded(async () => {
        const task = getTask(await store.load({ migrate }), id);
        return task ? text(formatTaskDetail(task)) : notFound(id);
      }),
  );

  server.registerTool(
    'get_backlog_summary',
    {
      title: 'Summarize the backlog',
      description:
        'Return a compact list of all tasks grouped by status (TODO, DONE, CLOSED), without full details. Token-efficient.',
      inputSchema: { migrate: migrateSchema },
    },
    async ({ migrate }) =>
      guarded(async () => {
        const summary = renderSummary(await store.load({ migrate }));
        return text(summary);
      }),
  );

  server.registerTool(
    'export_backlog',
    {
      title: 'Export the backlog',
      description: 'Export all tasks to a CSV or JSON file for external tools.',
      inputSchema: { format: z.enum(['csv', 'json']), migrate: migrateSchema },
    },
    async ({ format, migrate }) =>
      guarded(async () => {
        const { filename, content } = exportBacklog(await store.load({ migrate }), format);
        const outPath = join(options.exportDir, filename);
        await writeFile(outPath, content, 'utf8');
        return text(`Exported to ${format} format. Saved to ${outPath}.`);
      }),
  );

  server.registerTool(
    'add_epic',
    {
      title: 'Add an epic',
      description:
        'Add a new epic: a named grouping of tasks. Opt-in — use only if the user wants to organize tasks into epics.',
      inputSchema: {
        title: z.string().min(1),
        description: z.string(),
        migrate: migrateSchema,
      },
    },
    async ({ title, description, migrate }) =>
      guarded(async () => {
        const epic = await store.mutate((doc) => addEpic(doc, { title, description }), {
          migrate,
        });
        return text(`Created epic #${epic.id}.`);
      }),
  );

  server.registerTool(
    'update_epic',
    {
      title: "Update an epic's field",
      description: "Edit an epic's title or description.",
      inputSchema: {
        id: idSchema,
        field: z.enum(['title', 'description']),
        value: z.string(),
        migrate: migrateSchema,
      },
    },
    async ({ id, field, value, migrate }) =>
      guarded(async () => {
        try {
          await store.mutate((doc) => updateEpic(doc, { id, field, value }), { migrate });
          return text(`Epic #${id}'s ${field} updated.`);
        } catch (err) {
          if (err instanceof EpicNotFoundError) return notFoundEpic(id);
          throw err;
        }
      }),
  );

  server.registerTool(
    'remove_epic',
    {
      title: 'Delete an epic',
      description: 'Permanently remove an epic. Tasks linked to it are unlinked, not deleted.',
      inputSchema: { id: idSchema, migrate: migrateSchema },
    },
    async ({ id, migrate }) =>
      guarded(async () => {
        try {
          await store.mutate((doc) => removeEpic(doc, id), { migrate });
          return text(`Epic #${id} removed. Any linked tasks were unlinked.`);
        } catch (err) {
          if (err instanceof EpicNotFoundError) return notFoundEpic(id);
          throw err;
        }
      }),
  );

  server.registerTool(
    'set_task_epic',
    {
      title: "Link or unlink a task's epic",
      description:
        'Link a task to an epic. Omit epicId to unlink the task from whatever epic it was in.',
      inputSchema: { id: idSchema, epicId: idSchema.optional(), migrate: migrateSchema },
    },
    async ({ id, epicId, migrate }) =>
      guarded(async () => {
        try {
          await store.mutate((doc) => setTaskEpic(doc, { id, epicId }), { migrate });
          return text(
            epicId !== undefined
              ? `Task #${id} linked to epic #${epicId}.`
              : `Task #${id} unlinked from its epic.`,
          );
        } catch (err) {
          if (err instanceof TaskNotFoundError) return notFound(id);
          if (err instanceof EpicNotFoundError) return notFoundEpic(epicId ?? -1);
          throw err;
        }
      }),
  );

  server.registerTool(
    'get_epic',
    {
      title: 'Get an epic',
      description: "Retrieve a single epic's title and description by id.",
      inputSchema: { id: idSchema, migrate: migrateSchema },
    },
    async ({ id, migrate }) =>
      guarded(async () => {
        const epic = getEpic(await store.load({ migrate }), id);
        return epic ? text(formatEpicDetail(epic)) : notFoundEpic(id);
      }),
  );

  server.registerTool(
    'list_epics',
    {
      title: 'List all epics',
      description: 'Return a compact list of all epics (id and title only). Token-efficient.',
      inputSchema: { migrate: migrateSchema },
    },
    async ({ migrate }) =>
      guarded(async () => {
        const epics = listEpics(await store.load({ migrate }));
        return text(formatEpicList(epics));
      }),
  );

  server.registerTool(
    'get_epic_tasks',
    {
      title: 'List the tasks in an epic',
      description: 'Return a compact list of all tasks linked to the given epic.',
      inputSchema: { id: idSchema, migrate: migrateSchema },
    },
    async ({ id, migrate }) =>
      guarded(async () => {
        const doc = await store.load({ migrate });
        if (!getEpic(doc, id)) return notFoundEpic(id);
        return text(formatEpicTaskList(id, getEpicTasks(doc, id)));
      }),
  );

  return server;
}
