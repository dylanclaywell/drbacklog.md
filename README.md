# DrBacklog.md

An [MCP](https://modelcontextprotocol.io) server that manages a software
development backlog stored entirely in a single flat Markdown file
(`backlog.md`). Optimized for token efficiency and clean human/AI collaboration.

## How it works

The backlog file has two zones:

- **The index (top)** — compact checkbox lists of task titles per status
  section, each linking to its detail block. This zone is _derived_: the
  server rebuilds it from the task details on every write, so it never drifts.
- **Task Details (bottom)** — the authoritative record of every task, with
  full descriptions and resolutions.

Tasks live in three sections, keyed by status: `TODO`, `DONE`, `CLOSED`.

Each task has a stable, id-based anchor (`<a id="task-101"></a>`), so editing a
title never breaks the index links.

### Example `backlog.md`

```markdown
# DrBacklog

## TODO

- [ ] [#101: Implement OAuth2 login](#task-101)

## DONE

- [x] [#102: Fix database migration timeout](#task-102)

## CLOSED

---

## Task Details

<a id="task-101"></a>

### #101: Implement OAuth2 login

- **Status:** TODO
- **Created:** 2026-07-16
- **Description:** Integrate Google and GitHub authentication.
```

Content the parser doesn't recognize (freeform notes, unknown fields) is
preserved verbatim on a round trip, so hand-edits survive.

### Epics (optional)

Tasks can optionally be grouped into epics. This is entirely opt-in: a
backlog with no epics renders exactly as above, with no extra section. An
epic is just a named grouping — it has no status of its own; whether its
tasks are done is tracked per-task, same as always.

Once a task is linked to an epic, its details block gains an `Epic` field and
an `## Epics` section appears at the end of the file:

```markdown
<a id="task-101"></a>

### #101: Implement OAuth2 login

- **Status:** TODO
- **Created:** 2026-07-16
- **Epic:** #5
- **Description:** Integrate Google and GitHub authentication.

## Epics

<a id="epic-5"></a>

### Epic #5: Auth overhaul

- **Description:** Replace the old session system.
```

The top index never shows epic membership (it stays exactly the compact
checkbox list it's always been) — that's only visible in a task's or epic's
own details. Manage epics with `add_epic`, `update_epic`, `remove_epic`, and
`set_task_epic` (link or, called with no `epicId`, unlink); read them back
with `get_epic`, `list_epics`, and `get_epic_tasks` (see [Tools](#tools)).

### Migrating an old (pre-rename) `backlog.md`

Versions before 0.3.0 used a hospital-themed format (`🚨 CRITICAL (TODO)`,
`🩺 STABLE (DONE)`, `🗂️ ARCHIVED (CLOSED)`, `🔬 Patient Ledger`, and an
`Admitted` field). Every tool detects an old-format file and refuses to run,
returning a message asking the AI to confirm with you and retry the same call
with `migrate: true`. That migrates the file in place — renaming headings and
`Admitted` → `Created`, changing no task data — then runs the originally
requested action. No separate migration step or tool call is needed; just
approve it when asked.

## Install

Requires Node.js ≥ 20. There are two ways to install; pick one, then see
[Configure in Claude Code](#configure-in-claude-code) below.

### Option A — from source

Best if you want to track `main` or hack on the server.

```bash
git clone https://github.com/dylanclaywell/drbacklog.md
cd drbacklog.md
npm install
npm run build
```

This compiles to `dist/`, with the server entrypoint at `dist/index.js`. Point
your MCP config at that absolute path (see the `node` example below).

### Option B — from a release tarball

Best for a plain install. Each [GitHub Release](https://github.com/dylanclaywell/drbacklog.md/releases)
attaches a prebuilt `drbacklog-<version>.tgz` — it already contains the compiled
`dist/`, so no build step is needed. Download it, then install globally:

```bash
npm i -g ./drbacklog-<version>.tgz
```

This puts a `drbacklog` command on your `PATH`; point your MCP config at that
command name (see the `drbacklog` example below).

## Configure in Claude Code

Add the server to your MCP config (e.g. a project-scoped `.mcp.json`).

**Option A (from source)** — run the built entrypoint with `node`:

```json
{
  "mcpServers": {
    "drbacklog": {
      "command": "node",
      "args": ["/absolute/path/to/drbacklog.md/dist/index.js"]
    }
  }
}
```

**Option B (global install)** — reference the `drbacklog` command directly:

```json
{
  "mcpServers": {
    "drbacklog": {
      "command": "drbacklog"
    }
  }
}
```

> **Windows note:** if the bare `drbacklog` command fails to launch, the global
> npm shim may not be on the resolved `PATH`. Use its full path instead — the
> bin lives one directory up from `npm root -g`, typically
> `C:\Users\<you>\AppData\Roaming\npm\drbacklog.cmd`.

### Where the backlog file lives

The file path is resolved in this order:

1. **`DRBACKLOG_FILE`** environment variable — an explicit path (absolute, or
   relative to the working directory). Set it in the server's `env` block in
   `.mcp.json` (shown below) to pin one shared file.
2. **`CLAUDE_PROJECT_DIR`/backlog.md** — Claude Code sets `CLAUDE_PROJECT_DIR`
   to the project root, so with no configuration each project automatically
   gets its own `backlog.md` — even from a single user-scoped server entry.
3. **`./backlog.md`** in the current working directory — final fallback.

To pin one shared file, add an `env` block to the server entry:

```json
{
  "mcpServers": {
    "drbacklog": {
      "command": "node",
      "args": ["/absolute/path/to/drbacklog.md/dist/index.js"],
      "env": { "DRBACKLOG_FILE": "/absolute/path/to/shared/backlog.md" }
    }
  }
}
```

The file is created with an empty skeleton on first run if it doesn't exist.

## Tools

| Tool                  | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `add_task`            | Add a new task (starts as TODO).                           |
| `move_task`           | Change a task's status; optionally record a resolution.    |
| `update_task`         | Edit a task's title, description, or resolution.           |
| `remove_task`         | Permanently delete a task.                                 |
| `get_task`            | Retrieve one task's full details by id.                    |
| `get_backlog_summary` | Compact list of all tasks by status, without the details.  |
| `export_backlog`      | Export all tasks to a CSV or JSON file for external tools. |
| `find_tasks`          | Fuzzy-search tasks by title/description, ranked best-first. |
| `add_epic`            | Add a new epic.                                            |
| `update_epic`         | Edit an epic's title or description.                       |
| `remove_epic`         | Permanently delete an epic (unlinks its tasks, not delete). |
| `set_task_epic`       | Link a task to an epic; omit `epicId` to unlink.            |
| `get_epic`            | Retrieve one epic's title and description by id.            |
| `list_epics`          | Compact list of all epics (id and title only).             |
| `get_epic_tasks`      | Compact list of all tasks linked to a given epic.           |

## Development

```bash
npm run dev          # run the server with live reload
npm test             # run the test suite (vitest)
npm run typecheck    # type-check without emitting
npm run lint         # eslint
npm run format       # prettier --write
```
