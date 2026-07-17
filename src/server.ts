// MCP server wiring: registers the DrBacklog tools against a BacklogStore.
//
// Tool names are plain and conventional; the themed medical persona lives only
// in the human-readable result strings. Mutations go through store.mutate so
// they are serialized and persisted atomically; reads use store.load.

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  addTask,
  exportBacklog,
  getTask,
  moveTask,
  removeTask,
  TaskNotFoundError,
  updateTask,
} from './operations.js';
import { renderSummary } from './render.js';
import type { BacklogStore } from './store.js';
import type { Task } from './model.js';

const idSchema = z.coerce.number().int().positive();

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
  return errorText(`🚑 No patient #${id} found in the records.`);
}

/** Today's date as YYYY-MM-DD from the server clock. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTaskDetail(task: Task): string {
  const lines = [
    `🗒️ Patient #${task.id} chart:`,
    `* Status: ${task.status}`,
    `* Admitted: ${task.admitted}`,
    `* Title: ${task.title}`,
    `* Description: ${task.description}`,
  ];
  if (task.resolution !== undefined) lines.push(`* Resolution: ${task.resolution}`);
  return lines.join('\n');
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
      },
    },
    async ({ title, description }) => {
      const task = await store.mutate((doc) =>
        addTask(doc, { title, description, admitted: today() }),
      );
      return text(`🔬 Diagnosis: New task #${task.id} admitted to the TODO ward.`);
    },
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
      },
    },
    async ({ id, status, resolution }) => {
      try {
        await store.mutate((doc) => moveTask(doc, { id, status, resolution }));
        return text(`🩻 Operation: Patient #${id} successfully transferred to ${status}.`);
      } catch (err) {
        if (err instanceof TaskNotFoundError) return notFound(id);
        throw err;
      }
    },
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
      },
    },
    async ({ id, field, value }) => {
      try {
        await store.mutate((doc) => updateTask(doc, { id, field, value }));
        return text(`🩹 Chart Updated: Patient #${id}'s ${field} has been updated.`);
      } catch (err) {
        if (err instanceof TaskNotFoundError) return notFound(id);
        throw err;
      }
    },
  );

  server.registerTool(
    'remove_task',
    {
      title: 'Delete a task',
      description: 'Permanently remove a task from the backlog.',
      inputSchema: { id: idSchema },
    },
    async ({ id }) => {
      try {
        await store.mutate((doc) => removeTask(doc, id));
        return text(`🗑️ Records purged: Patient #${id} has been removed from the backlog.`);
      } catch (err) {
        if (err instanceof TaskNotFoundError) return notFound(id);
        throw err;
      }
    },
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get a task',
      description: "Retrieve a single task's full details by id.",
      inputSchema: { id: idSchema },
    },
    async ({ id }) => {
      const task = getTask(await store.load(), id);
      return task ? text(formatTaskDetail(task)) : notFound(id);
    },
  );

  server.registerTool(
    'get_backlog_summary',
    {
      title: 'Summarize the backlog',
      description:
        'Return a compact list of all tasks grouped by status (TODO, DONE, CLOSED), without full details. Token-efficient.',
    },
    async () => {
      const summary = renderSummary(await store.load());
      return text(`📋 Generating Backlog Health Chart...\n\n${summary}`);
    },
  );

  server.registerTool(
    'export_backlog',
    {
      title: 'Export the backlog',
      description: 'Export all tasks to a CSV or JSON file for external tools.',
      inputSchema: { format: z.enum(['csv', 'json']) },
    },
    async ({ format }) => {
      const { filename, content } = exportBacklog(await store.load(), format);
      const outPath = join(options.exportDir, filename);
      await writeFile(outPath, content, 'utf8');
      return text(
        `📁 Medical records exported successfully to ${format} format. Saved to ${outPath}.`,
      );
    },
  );

  return server;
}
