# DrBacklog

## TODO
- [ ] [#1: Add per-project override note to README](#task-1)
- [ ] [#2: Consider a persistent id counter](#task-2)
- [ ] [#3: Add GitHub Actions workflows (CI, release-please, publish)](#task-3)
- [ ] [#4: Markdown rendering showcase](#task-4)
- [ ] [#5: Scroll the epic panel (test)](#task-5) !!!
- [ ] [#6: Link tasks to epics from the TUI (test)](#task-6) !!
- [ ] [#7: Untriaged epic task (test)](#task-7)
- [ ] [#12: Overflow task one (test)](#task-12)
- [ ] [#13: Overflow task two (test)](#task-13)
- [ ] [#14: Overflow task three (test)](#task-14)
- [ ] [#15: Overflow task four (test)](#task-15)
- [ ] [#16: Overflow task five (test)](#task-16)
- [ ] [#17: Overflow task six (test)](#task-17)
- [ ] [#18: Overflow task seven (test)](#task-18)
- [ ] [#19: Overflow task eight (test)](#task-19)

## DONE
- [x] [#8: Show epic progress counts (test)](#task-8) !
- [x] [#10: Tag releases automatically (test)](#task-10)
- [x] [#20: Overflow task nine (test)](#task-20)
- [x] [#21: Overflow task ten (test)](#task-21)

## CLOSED
- [x] [#9: Epic swimlanes on the board (test)](#task-9)
- [x] [#11: Publish to a package registry (test)](#task-11)

---

## Task Details

<a id="task-1"></a>
### #1: Add per-project override note to README
* **Status:** TODO
* **Created:** 2026-07-17
* **Description:** Document that a project-scoped .mcp.json entry with the same server name overrides the global/user one, and must repeat the full command/args/env block since scopes don't merge.

<a id="task-2"></a>
### #2: Consider a persistent id counter
* **Status:** TODO
* **Created:** 2026-07-17
* **Description:** nextId is highest-id + 1, so deleting the highest task frees its id for reuse. If that ever causes confusion, store a lastId counter instead.

<a id="task-3"></a>
### #3: Add GitHub Actions workflows (CI, release-please, publish)
* **Status:** TODO
* **Created:** 2026-07-17
* **Description:** Set up GitHub workflows: (1) CI to build/typecheck/lint/test on push and PR; (2) release-please to automate releases and changelog generation from conventional commits; (3) publish the package to the GitHub npm registry on release.
* **Resolution:** Added .github/workflows/ci.yml (typecheck/lint/format/test/build on push+PR) and release.yml (release-please + npm pack tarball to GitHub Release), release-please-config.json, .release-please-manifest.json. Distribution via GitHub Releases, no npm registry.

<a id="task-4"></a>
### #4: Markdown rendering showcase
* **Status:** TODO
* **Created:** 2026-10-21
* **Description:** # Heading level 1
## Heading level 2
### Heading level 3
Inline styles: **bold**, __also bold__, *italic*, _also italic_, ~~strikethrough~~, `inline code`, and **bold with *nested italic***.
Links show their text only: [the drbacklog repo](https://github.com/dylanclaywell/drbacklog.md). Images show dimmed alt text: ![a diagram](diagram.png)
Left alone: snake_case_names, 2 * 3 * 4, an **unclosed marker, and escaped \*asterisks\*.
- A bullet item
- A bullet item long enough to wrap onto a second row, so you can see the hanging indent line up under the text
  - A nested bullet
1. A numbered item
2. Another numbered item
- [ ] An open checklist item
- [x] A finished checklist item (dimmed)
> A blockquote, in italics, long enough to wrap so the bar repeats on every row it takes up.
>> A nested quote
---
```ts
function example(x: number) {
  return x   *   2; // spacing kept, never reflowed
}
```
    Indented code (four spaces) is shown as code too.
| Table | Rows |
| ----- | ---- |
| are   | kept as written |

<a id="task-5"></a>
### #5: Scroll the epic panel (test)
* **Status:** TODO
* **Priority:** HIGH
* **Created:** 2026-11-04
* **Epic:** #1
* **Description:** Test task: open, HIGH priority.

<a id="task-6"></a>
### #6: Link tasks to epics from the TUI (test)
* **Status:** TODO
* **Priority:** MEDIUM
* **Created:** 2026-11-04
* **Epic:** #1
* **Description:** Test task: open, MEDIUM priority.

<a id="task-7"></a>
### #7: Untriaged epic task (test)
* **Status:** TODO
* **Created:** 2026-11-04
* **Epic:** #1
* **Description:** Test task: open, no priority.

<a id="task-8"></a>
### #8: Show epic progress counts (test)
* **Status:** DONE
* **Priority:** LOW
* **Created:** 2026-11-04
* **Epic:** #1
* **Description:** Test task: will be moved to DONE.
* **Resolution:** Test resolution: counts shipped.

<a id="task-9"></a>
### #9: Epic swimlanes on the board (test)
* **Status:** CLOSED
* **Created:** 2026-11-04
* **Epic:** #1
* **Description:** Test task: will be moved to CLOSED.
* **Resolution:** Test resolution: not doing this.

<a id="task-10"></a>
### #10: Tag releases automatically (test)
* **Status:** DONE
* **Created:** 2026-11-04
* **Epic:** #2
* **Description:** Test task: will be moved to DONE.

<a id="task-11"></a>
### #11: Publish to a package registry (test)
* **Status:** CLOSED
* **Created:** 2026-11-04
* **Epic:** #2
* **Description:** Test task: will be moved to CLOSED.

<a id="task-12"></a>
### #12: Overflow task one (test)
* **Status:** TODO
* **Created:** 2026-11-04
* **Epic:** #4
* **Description:** Test task for the overflowing epic.

<a id="task-13"></a>
### #13: Overflow task two (test)
* **Status:** TODO
* **Created:** 2026-11-04
* **Epic:** #4
* **Description:** Test task for the overflowing epic.

<a id="task-14"></a>
### #14: Overflow task three (test)
* **Status:** TODO
* **Created:** 2026-11-04
* **Epic:** #4
* **Description:** Test task for the overflowing epic.

<a id="task-15"></a>
### #15: Overflow task four (test)
* **Status:** TODO
* **Created:** 2026-11-04
* **Epic:** #4
* **Description:** Test task for the overflowing epic.

<a id="task-16"></a>
### #16: Overflow task five (test)
* **Status:** TODO
* **Created:** 2026-11-04
* **Epic:** #4
* **Description:** Test task for the overflowing epic.

<a id="task-17"></a>
### #17: Overflow task six (test)
* **Status:** TODO
* **Created:** 2026-11-04
* **Epic:** #4
* **Description:** Test task for the overflowing epic.

<a id="task-18"></a>
### #18: Overflow task seven (test)
* **Status:** TODO
* **Created:** 2026-11-04
* **Epic:** #4
* **Description:** Test task for the overflowing epic.

<a id="task-19"></a>
### #19: Overflow task eight (test)
* **Status:** TODO
* **Created:** 2026-11-04
* **Epic:** #4
* **Description:** Test task for the overflowing epic.

<a id="task-20"></a>
### #20: Overflow task nine (test)
* **Status:** DONE
* **Created:** 2026-11-04
* **Epic:** #4
* **Description:** Test task for the overflowing epic.

<a id="task-21"></a>
### #21: Overflow task ten (test)
* **Status:** DONE
* **Created:** 2026-11-04
* **Epic:** #4
* **Description:** Test task for the overflowing epic.

## Epics

<a id="epic-1"></a>
### Epic #1: Epic view polish (test)
* **Description:** Test epic with tasks in **every** status, to check the per-status counts and the open-first task order in the panel.

<a id="epic-2"></a>
### Epic #2: Release pipeline (test)
* **Description:** Test epic whose tasks are all resolved: its count should show in green.

<a id="epic-3"></a>
### Epic #3: An empty test epic with a deliberately long title, to check that the progress count stays visible at the right edge
* **Description:**

<a id="epic-4"></a>
### Epic #4: Overflowing epic (test)
* **Description:** Test epic with more content than the panel can hold, to check the "↓ N more" hint.
- A bullet point
- Another bullet point, long enough that it should wrap onto a second row in a panel of ordinary width
```ts
const epic = { id: 4, tasks: 10 };
```
> A closing quote so the description takes up a good share of the panel.
