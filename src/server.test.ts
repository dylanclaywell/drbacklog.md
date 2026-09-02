import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { BacklogStore } from './store.js';
import { createServer } from './server.js';

interface TextResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

function resultText(result: unknown): string {
  return (result as TextResult).content.map((c) => c.text).join('\n');
}

describe('MCP server', () => {
  let dir: string;
  let client: Client;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drbacklog-mcp-'));
    const store = new BacklogStore(join(dir, 'backlog.md'));
    await store.ensureInitialized();
    const server = createServer(store, { exportDir: dir });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function call(name: string, args?: Record<string, unknown>): Promise<TextResult> {
    return (await client.callTool({ name, arguments: args })) as TextResult;
  }

  it('exposes all fourteen tools', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'add_task',
        'export_backlog',
        'get_backlog_summary',
        'get_task',
        'move_task',
        'remove_task',
        'update_task',
        'add_epic',
        'update_epic',
        'remove_epic',
        'set_task_epic',
        'get_epic',
        'list_epics',
        'get_epic_tasks',
      ].sort(),
    );
  });

  it('add_task creates a task and reports its id', async () => {
    const result = await call('add_task', { title: 'Login', description: 'OAuth2 flow.' });
    expect(resultText(result)).toContain('Created task #1');
  });

  it('moves a task to DONE with a resolution and reads it back', async () => {
    await call('add_task', { title: 'Login', description: 'OAuth2 flow.' });
    const moved = await call('move_task', { id: 1, status: 'DONE', resolution: 'Shipped.' });
    expect(resultText(moved)).toContain('Task #1 moved to DONE');

    const detail = resultText(await call('get_task', { id: 1 }));
    expect(detail).toContain('Status: DONE');
    expect(detail).toContain('Resolution: Shipped.');
  });

  it('coerces a string id from the client', async () => {
    await call('add_task', { title: 'Login', description: 'OAuth2 flow.' });
    const detail = resultText(await call('get_task', { id: '1' }));
    expect(detail).toContain('Task #1:');
  });

  it('returns an error result for an unknown id', async () => {
    const result = await call('move_task', { id: 999, status: 'DONE' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('No task #999');
  });

  it('get_backlog_summary lists tasks but omits the task details', async () => {
    await call('add_task', { title: 'Login', description: 'OAuth2 flow.' });
    const summary = resultText(await call('get_backlog_summary', {}));
    expect(summary).toContain('[#1: Login](#task-1)');
    expect(summary).not.toContain('* **Status:**');
  });

  it('export_backlog writes a JSON file to the export directory', async () => {
    await call('add_task', { title: 'Login', description: 'OAuth2 flow.' });
    const result = resultText(await call('export_backlog', { format: 'json' }));
    expect(result).toContain('Exported to json');

    const written = await readFile(join(dir, 'backlog.json'), 'utf8');
    const parsed = JSON.parse(written) as Array<{ id: number; title: string }>;
    expect(parsed).toEqual([expect.objectContaining({ id: 1, title: 'Login' })]);
  });

  describe('epics', () => {
    it('add_epic creates an epic and reports its id', async () => {
      const result = await call('add_epic', {
        title: 'Auth overhaul',
        description: 'Replace sessions.',
      });
      expect(resultText(result)).toContain('Created epic #1');
    });

    it('set_task_epic links a task, get_epic_tasks lists it, then unlinks', async () => {
      await call('add_task', { title: 'Add OAuth', description: 'OAuth2 flow.' });
      await call('add_epic', { title: 'Auth overhaul', description: 'Replace sessions.' });

      const linked = await call('set_task_epic', { id: 1, epicId: 1 });
      expect(resultText(linked)).toContain('Task #1 linked to epic #1');

      const detail = resultText(await call('get_task', { id: 1 }));
      expect(detail).toContain('* Epic: #1');

      const tasks = resultText(await call('get_epic_tasks', { id: 1 }));
      expect(tasks).toContain('[#1: Add OAuth](#task-1)');

      const unlinked = await call('set_task_epic', { id: 1 });
      expect(resultText(unlinked)).toContain('Task #1 unlinked from its epic');
      expect(resultText(await call('get_epic_tasks', { id: 1 }))).toContain('No tasks linked');
    });

    it('get_epic and list_epics report epic details', async () => {
      await call('add_epic', { title: 'Auth overhaul', description: 'Replace sessions.' });
      expect(resultText(await call('get_epic', { id: 1 }))).toContain('Epic #1: Auth overhaul');
      expect(resultText(await call('list_epics', {}))).toContain('#1: Auth overhaul');
    });

    it('update_epic edits a field', async () => {
      await call('add_epic', { title: 'Auth overhaul', description: 'Replace sessions.' });
      await call('update_epic', { id: 1, field: 'title', value: 'Auth revamp' });
      expect(resultText(await call('get_epic', { id: 1 }))).toContain('Epic #1: Auth revamp');
    });

    it('remove_epic deletes the epic and unlinks its tasks', async () => {
      await call('add_task', { title: 'Add OAuth', description: 'OAuth2 flow.' });
      await call('add_epic', { title: 'Auth overhaul', description: 'Replace sessions.' });
      await call('set_task_epic', { id: 1, epicId: 1 });

      const removed = await call('remove_epic', { id: 1 });
      expect(resultText(removed)).toContain('Epic #1 removed');

      expect(await call('get_epic', { id: 1 })).toMatchObject({ isError: true });
      expect(resultText(await call('get_epic_tasks', { id: 1 }))).toContain('No epic #1 found');

      const detail = resultText(await call('get_task', { id: 1 }));
      expect(detail).not.toContain('Epic');
    });

    it('returns an error for an unknown epic id', async () => {
      const result = await call('get_epic', { id: 999 });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain('No epic #999');
    });

    it('set_task_epic rejects linking to an unknown epic', async () => {
      await call('add_task', { title: 'Add OAuth', description: 'OAuth2 flow.' });
      const result = await call('set_task_epic', { id: 1, epicId: 999 });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain('No epic #999');
    });
  });

  describe('legacy format', () => {
    const LEGACY_FILE = [
      '# 🏥 DrBacklog Patient Chart',
      '',
      '## 🚨 CRITICAL (TODO)',
      '- [ ] [#1: Legacy task](#task-1)',
      '',
      '## 🩺 STABLE (DONE)',
      '',
      '## 🗂️ ARCHIVED (CLOSED)',
      '',
      '---',
      '',
      '## 🔬 Patient Ledger (Task Details)',
      '',
      '<a id="task-1"></a>',
      '### #1: Legacy task',
      '* **Status:** TODO',
      '* **Admitted:** 2026-07-16',
      '* **Description:** Predates the rename.',
      '',
    ].join('\n');

    beforeEach(async () => {
      await writeFile(join(dir, 'backlog.md'), LEGACY_FILE, 'utf8');
    });

    it('refuses to run and asks for migrate:true, without touching the file', async () => {
      const result = await call('get_task', { id: 1 });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain('migrate: true');
      expect(await readFile(join(dir, 'backlog.md'), 'utf8')).toBe(LEGACY_FILE);
    });

    it('migrate:true migrates the file, then runs the originally requested tool call', async () => {
      const result = await call('move_task', { id: 1, status: 'DONE', migrate: true });
      expect(resultText(result)).toContain('Task #1 moved to DONE');

      const onDisk = await readFile(join(dir, 'backlog.md'), 'utf8');
      expect(onDisk).toContain('## TODO');
      expect(onDisk).not.toContain('CRITICAL');

      const detail = resultText(await call('get_task', { id: 1 }));
      expect(detail).toContain('Status: DONE');
    });
  });
});
