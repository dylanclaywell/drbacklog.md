# 🏥 DrBacklog Patient Chart

## 🚨 CRITICAL (TODO)
- [ ] [#1: Add per-project override note to README](#task-1)
- [ ] [#2: Consider a persistent id counter](#task-2)

## 🩺 STABLE (DONE)
- [x] [#3: Add GitHub Actions workflows (CI, release-please, publish)](#task-3)

## 🗂️ ARCHIVED (CLOSED)

---

## 🔬 Patient Ledger (Task Details)

<a id="task-1"></a>
### #1: Add per-project override note to README
* **Status:** TODO
* **Admitted:** 2026-07-17
* **Description:** Document that a project-scoped .mcp.json entry with the same server name overrides the global/user one, and must repeat the full command/args/env block since scopes don't merge.

<a id="task-2"></a>
### #2: Consider a persistent id counter
* **Status:** TODO
* **Admitted:** 2026-07-17
* **Description:** nextId is highest-id + 1, so deleting the highest task frees its id for reuse. If that ever causes confusion, store a lastId counter instead.

<a id="task-3"></a>
### #3: Add GitHub Actions workflows (CI, release-please, publish)
* **Status:** DONE
* **Admitted:** 2026-07-17
* **Description:** Set up GitHub workflows: (1) CI to build/typecheck/lint/test on push and PR; (2) release-please to automate releases and changelog generation from conventional commits; (3) publish the package to the GitHub npm registry on release.
* **Resolution:** Added .github/workflows/ci.yml (typecheck/lint/format/test/build on push+PR) and release.yml (release-please + npm pack tarball to GitHub Release), release-please-config.json, .release-please-manifest.json. Distribution via GitHub Releases, no npm registry.
