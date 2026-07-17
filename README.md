# 🏥 DrBacklog.md

An [MCP](https://modelcontextprotocol.io) server that manages a software
development backlog stored entirely in a single flat Markdown file
(`backlog.md`). Optimized for token efficiency and clean human/AI collaboration,
with a lightly playful medical persona in its feedback.

## How it works

The backlog file has two zones:

- **The index (top)** — compact checkbox lists of task titles per ward, each
  linking to its detail block. This zone is _derived_: the server rebuilds it
  from the ledger on every write, so it never drifts.
- **The ledger (bottom)** — the authoritative record of every task, with full
  descriptions and resolutions.

Tasks live in three wards, keyed by status:

| Status   | Ward        |
| -------- | ----------- |
| `TODO`   | 🚨 CRITICAL |
| `DONE`   | 🩺 STABLE   |
| `CLOSED` | 🗂️ ARCHIVED |

Each task has a stable, id-based anchor (`<a id="task-101"></a>`), so editing a
title never breaks the index links.

### Example `backlog.md`

```markdown
# 🏥 DrBacklog Patient Chart

## 🚨 CRITICAL (TODO)

- [ ] [#101: Implement OAuth2 login](#task-101)

## 🩺 STABLE (DONE)

- [x] [#102: Fix database migration timeout](#task-102)

## 🗂️ ARCHIVED (CLOSED)

---

## 🔬 Patient Ledger (Task Details)

<a id="task-101"></a>

### #101: Implement OAuth2 login

- **Status:** TODO
- **Admitted:** 2026-07-16
- **Description:** Integrate Google and GitHub authentication.
```

Content the parser doesn't recognize (freeform notes, unknown fields) is
preserved verbatim on a round trip, so hand-edits survive.

## Install & build

Requires Node.js ≥ 20.

```bash
npm install
npm run build
```

This compiles to `dist/`, with the server entrypoint at `dist/index.js`.

## Configure in Claude Code

Add the server to your MCP config (e.g. a project-scoped `.mcp.json`):

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

Tool names and descriptions are plain; the medical persona appears only in the
human-readable result messages.

## Development

```bash
npm run dev          # run the server with live reload
npm test             # run the test suite (vitest)
npm run typecheck    # type-check without emitting
npm run lint         # eslint
npm run format       # prettier --write
```
