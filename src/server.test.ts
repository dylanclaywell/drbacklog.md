import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

  it('exposes all seven tools', async () => {
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
      ].sort(),
    );
  });

  it('add_task admits a task and reports the diagnosis', async () => {
    const result = await call('add_task', { title: 'Login', description: 'OAuth2 flow.' });
    expect(resultText(result)).toContain('#1 admitted to the TODO ward');
  });

  it('moves a task to DONE with a resolution and reads it back', async () => {
    await call('add_task', { title: 'Login', description: 'OAuth2 flow.' });
    const moved = await call('move_task', { id: 1, status: 'DONE', resolution: 'Shipped.' });
    expect(resultText(moved)).toContain('#1 successfully transferred to DONE');

    const detail = resultText(await call('get_task', { id: 1 }));
    expect(detail).toContain('Status: DONE');
    expect(detail).toContain('Resolution: Shipped.');
  });

  it('coerces a string id from the client', async () => {
    await call('add_task', { title: 'Login', description: 'OAuth2 flow.' });
    const detail = resultText(await call('get_task', { id: '1' }));
    expect(detail).toContain('Patient #1 chart');
  });

  it('returns an error result for an unknown id', async () => {
    const result = await call('move_task', { id: 999, status: 'DONE' });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('No patient #999');
  });

  it('get_backlog_summary lists tasks but omits the ledger', async () => {
    await call('add_task', { title: 'Login', description: 'OAuth2 flow.' });
    const summary = resultText(await call('get_backlog_summary'));
    expect(summary).toContain('Backlog Health Chart');
    expect(summary).toContain('[#1: Login](#task-1)');
    expect(summary).not.toContain('* **Status:**');
  });

  it('export_backlog writes a JSON file to the export directory', async () => {
    await call('add_task', { title: 'Login', description: 'OAuth2 flow.' });
    const result = resultText(await call('export_backlog', { format: 'json' }));
    expect(result).toContain('exported successfully to json');

    const written = await readFile(join(dir, 'backlog.json'), 'utf8');
    const parsed = JSON.parse(written) as Array<{ id: number; title: string }>;
    expect(parsed).toEqual([expect.objectContaining({ id: 1, title: 'Login' })]);
  });
});
