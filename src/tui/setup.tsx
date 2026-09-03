// First-run setup prompt: when no backlog file is found where the TUI looked,
// ask for one instead of silently creating `backlog.md` in whatever directory
// the TUI happened to start in. Modeled on Godot's "attach script" dialog —
// one path field that tells you, live as you type, whether it will open an
// existing file or create a new one.

import { Box, Text, render, useApp, useInput } from 'ink';
import React, { useEffect, useState } from 'react';
import { stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, resolve } from 'node:path';

import { CONFIG_FILENAME } from '../config.js';

const ACCENT = '#a78bfa'; // matches the TUI's accent (see app.tsx THEME)
const FOUND = '#34d399';
const ERROR = '#f87171';

/**
 * Turn what the user typed into the absolute path we'd use, or null if it
 * can't be one. Relative names resolve against the directory the TUI already
 * looked in (the project dir), not the cwd, so typing a bare file name lands
 * next to the default. A name with no extension gets `.md` — the status line
 * shows the result, so nothing happens behind the user's back.
 */
export function resolveDraftPath(draft: string, baseDir: string): string | null {
  const trimmed = draft.trim();
  if (trimmed.length === 0) return null;
  const named = extname(trimmed).length === 0 ? `${trimmed}.md` : trimmed;
  return isAbsolute(named) ? resolve(named) : resolve(baseDir, named);
}

/** What the typed path currently points at, driving the status line. */
type Target =
  | { kind: 'empty' }
  | { kind: 'checking' }
  | { kind: 'found'; path: string }
  | { kind: 'new'; path: string }
  | { kind: 'directory'; path: string };

/** The prompt's outcome: which file to use, and whether to record it. */
export interface SetupChoice {
  /** Absolute path to the backlog file to open. */
  path: string;
  /** True when the user asked to save this path in the project config. */
  remember: boolean;
}

export interface SetupPromptProps {
  /** The path the TUI looked for and didn't find; seeds the input. */
  initialPath: string;
  /** Called with the user's choice when they confirm. */
  onSubmit: (choice: SetupChoice) => void;
  /** Called when the user backs out (esc / ctrl+c). */
  onCancel: () => void;
}

export function SetupPrompt({
  initialPath,
  onSubmit,
  onCancel,
}: SetupPromptProps): React.ReactElement {
  const baseDir = dirname(initialPath);
  const [draft, setDraft] = useState(initialPath);
  const [target, setTarget] = useState<Target>({ kind: 'checking' });
  // Two steps: pick the file, then (only when it isn't the path we already
  // resolve to) offer to remember it. `pending` holds the picked path while
  // the second step is up.
  const [pending, setPending] = useState<string | null>(null);

  // Re-check the file system on every keystroke. Stale responses are dropped
  // via `cancelled` so a slow stat for an earlier draft can't overwrite the
  // status of a newer one.
  useEffect(() => {
    const path = resolveDraftPath(draft, baseDir);
    if (path === null) {
      setTarget({ kind: 'empty' });
      return;
    }
    let cancelled = false;
    setTarget({ kind: 'checking' });
    stat(path)
      .then((info) => {
        if (!cancelled) setTarget({ kind: info.isDirectory() ? 'directory' : 'found', path });
      })
      .catch(() => {
        if (!cancelled) setTarget({ kind: 'new', path });
      });
    return () => {
      cancelled = true;
    };
  }, [draft, baseDir]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }

    // Second step: y/n (enter defaults to yes, esc goes back to the field).
    if (pending !== null) {
      if (key.escape) {
        setPending(null);
        return;
      }
      const answer = input.toLowerCase();
      if (key.return || answer === 'y') onSubmit({ path: pending, remember: true });
      else if (answer === 'n') onSubmit({ path: pending, remember: false });
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (target.kind !== 'found' && target.kind !== 'new') return;
      // Remembering the path we'd have resolved to anyway would just restate
      // the default, so only offer when the choice actually differs.
      if (target.path === initialPath) onSubmit({ path: target.path, remember: false });
      else setPending(target.path);
      return;
    }
    // Backspace and Delete both arrive as `key.delete` in practice; see the
    // same note in app.tsx's editor input handler.
    if (key.backspace || key.delete) {
      setDraft((d) => d.slice(0, -1));
      return;
    }
    if (key.ctrl && input === 'u') {
      setDraft('');
      return;
    }
    if (input && !key.ctrl && !key.meta) setDraft((d) => d + input);
  });

  if (pending !== null) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={ACCENT}>▍</Text>
          <Text bold> DrBacklog</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Using </Text>
          <Text bold>{pending}</Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Remember it in <Text bold>{CONFIG_FILENAME}</Text> so the MCP server and this TUI both
            find it?
          </Text>
        </Box>
        <Box>
          <Text dimColor>Commit that file and your whole project agrees on one backlog.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={ACCENT}>y/enter</Text>
          <Text dimColor> remember · </Text>
          <Text color={ACCENT}>n</Text>
          <Text dimColor> just this once · </Text>
          <Text color={ACCENT}>esc</Text>
          <Text dimColor> back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={ACCENT}>▍</Text>
        <Text bold> DrBacklog</Text>
      </Box>
      <Box marginTop={1}>
        <Text>No backlog file found at </Text>
        <Text dimColor>{initialPath}</Text>
      </Box>
      <Box>
        <Text dimColor>Enter the backlog file to use:</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={ACCENT}>❯ </Text>
        <Text>{draft}</Text>
        <Text inverse> </Text>
      </Box>
      <Box marginTop={1}>{renderStatus(target)}</Box>
      <Box marginTop={1}>
        <Text color={ACCENT}>enter</Text>
        <Text dimColor> continue · </Text>
        <Text color={ACCENT}>ctrl+u</Text>
        <Text dimColor> clear · </Text>
        <Text color={ACCENT}>esc</Text>
        <Text dimColor> quit</Text>
      </Box>
    </Box>
  );
}

function renderStatus(target: Target): React.ReactElement {
  switch (target.kind) {
    case 'empty':
      return <Text color={ERROR}>Enter a file name.</Text>;
    case 'checking':
      return <Text dimColor>Checking…</Text>;
    case 'directory':
      return <Text color={ERROR}>That path is a directory — name a file inside it.</Text>;
    case 'found':
      return (
        <Text color={FOUND}>
          Backlog found — using existing file <Text bold>{target.path}</Text>
        </Text>
      );
    case 'new':
      return (
        <Text color={ACCENT}>
          Creating backlog file <Text bold>{target.path}</Text>
        </Text>
      );
  }
}

/**
 * Render the prompt on its own, resolving to the user's choice, or null if they
 * backed out. Ink is unmounted before returning so the main app can take over
 * the terminal cleanly.
 */
export async function promptForBacklogPath(initialPath: string): Promise<SetupChoice | null> {
  let chosen: SetupChoice | null = null;
  const instance = render(
    React.createElement(SetupPromptExit, {
      initialPath,
      onChoose: (choice: SetupChoice | null) => {
        chosen = choice;
      },
    }),
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
  return chosen;
}

/** Wraps SetupPrompt so choosing (or cancelling) also exits the Ink app. */
function SetupPromptExit({
  initialPath,
  onChoose,
}: {
  initialPath: string;
  onChoose: (choice: SetupChoice | null) => void;
}): React.ReactElement {
  const { exit } = useApp();
  return (
    <SetupPrompt
      initialPath={initialPath}
      onSubmit={(choice) => {
        onChoose(choice);
        exit();
      }}
      onCancel={() => {
        onChoose(null);
        exit();
      }}
    />
  );
}
