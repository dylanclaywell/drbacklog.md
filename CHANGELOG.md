# Changelog

## [0.3.0](https://github.com/dylanclaywell/drbacklog.md/compare/drbacklog-v0.2.0...drbacklog-v0.3.0) (2026-09-03)


### ⚠ BREAKING CHANGES

* backlog.md files written by pre-rename versions use headings and field names this version no longer parses by default. Pass migrate: true on any tool call against such a file to upgrade it in place (see README's "Migrating an old backlog.md").

### Features

* add find_tasks fuzzy search tool ([66c1def](https://github.com/dylanclaywell/drbacklog.md/commit/66c1defedf9040e33e126403a366283fe3b1327f))
* add optional epics for grouping tasks ([71058f3](https://github.com/dylanclaywell/drbacklog.md/commit/71058f33537d7fbf29fa8a9ef7a23690424a1a60))
* added visual interest to the lists ([ba90137](https://github.com/dylanclaywell/drbacklog.md/commit/ba90137a34dc888be82e0051f43b9beae184db41))
* arrow-key cursor navigation in the description editor ([fc99ef2](https://github.com/dylanclaywell/drbacklog.md/commit/fc99ef2904f92bca467024e4cc1d49158ba4df61))
* editable task descriptions in the TUI ([99bb1a5](https://github.com/dylanclaywell/drbacklog.md/commit/99bb1a5c47bdb0d700cf77a9b9eff97c4a42affe))
* home/end/page up/down in the description editor ([7e1ea05](https://github.com/dylanclaywell/drbacklog.md/commit/7e1ea056f2a21028dd252167da1e621e60ffab6b))
* refine TUI visual design with recurring status motif ([c11fe79](https://github.com/dylanclaywell/drbacklog.md/commit/c11fe7937e9d7ca8748d9840b31ab9124a514f89))


### Bug Fixes

* correct fuzzy scorer's anchor and boundary bias ([ce1c5f6](https://github.com/dylanclaywell/drbacklog.md/commit/ce1c5f626913c8a2e3d39d46aa412254570457cb))
* description/title edits silently truncating on reload ([b7bfcbb](https://github.com/dylanclaywell/drbacklog.md/commit/b7bfcbbfba0b683ac70007da2b41d43f5b6a0b30))
* overlay the description-editor cursor instead of inserting it ([b53d9ce](https://github.com/dylanclaywell/drbacklog.md/commit/b53d9ce3a8519d071f913df9cda22a5d13473084))
* ran prettier ([50e3ccd](https://github.com/dylanclaywell/drbacklog.md/commit/50e3ccd176c27b6ee9461d50a68101f77a1d0feb))


### Refactors

* drop hospital theme from headings, fields, and messages ([92c8a29](https://github.com/dylanclaywell/drbacklog.md/commit/92c8a29141ec7e66b9106b6d89b6503c2eda7c5e))

## [0.2.0](https://github.com/dylanclaywell/drbacklog.md/compare/drbacklog-v0.1.0...drbacklog-v0.2.0) (2026-07-17)


### Features

* add addTask operation ([3474c15](https://github.com/dylanclaywell/drbacklog.md/commit/3474c15846daae480128bc906a6f1ea3e7c61914))
* add backlog domain model and ward constants ([0b5a8cc](https://github.com/dylanclaywell/drbacklog.md/commit/0b5a8cccfa9ed912e782fa5be72da1bd249ea551))
* add backlog.md parser ([943d66d](https://github.com/dylanclaywell/drbacklog.md/commit/943d66d4035faea45b0a9a57994dd1498517d9f2))
* add deterministic renderer with round-trip tests ([4a158f2](https://github.com/dylanclaywell/drbacklog.md/commit/4a158f2780be1612326680fbceb9d5b33013fac5))
* add exportBacklog serializer ([fd97add](https://github.com/dylanclaywell/drbacklog.md/commit/fd97addf2235aacee8dba34ea3dfe15e38b801e6))
* add file store with atomic writes and mutation locking ([add1edb](https://github.com/dylanclaywell/drbacklog.md/commit/add1edbfbd02b1f89f7307fcc4f079e4ffbb30c8))
* add getTask operation ([34aaf59](https://github.com/dylanclaywell/drbacklog.md/commit/34aaf59c2e10dd517ee792e3c1c46bbc213f6b81))
* add moveTask operation ([d830ae7](https://github.com/dylanclaywell/drbacklog.md/commit/d830ae7f88021154b09b9c2381de43f68f4b6aa7))
* add removeTask operation ([9cee1c7](https://github.com/dylanclaywell/drbacklog.md/commit/9cee1c730055e75a20bcd0ed1ff3ddf17e133205))
* add renderSummary for token-efficient backlog view ([241683e](https://github.com/dylanclaywell/drbacklog.md/commit/241683e2a866e26aef97cc84f0f53ef0a17feec8))
* add updateTask operation ([da83140](https://github.com/dylanclaywell/drbacklog.md/commit/da83140cbe14a5719b6085c12c81235a3e8d4549))
* wire MCP server over stdio ([c28566d](https://github.com/dylanclaywell/drbacklog.md/commit/c28566d3f9307c3156ea94e5128cf02adb356a08))


### Bug Fixes

* retry atomic rename on transient Windows errors ([0fc7cbf](https://github.com/dylanclaywell/drbacklog.md/commit/0fc7cbff59c1b2ab2ee3e8724a5cf1fab58a13cc))


### Chores

* add project-scoped MCP server config ([bb3d5bc](https://github.com/dylanclaywell/drbacklog.md/commit/bb3d5bce6489432d9aade375e59d764a15d832dd))
* scaffold TypeScript MCP project with lint and format tooling ([518277c](https://github.com/dylanclaywell/drbacklog.md/commit/518277c0a761790a9ee2d7041585fb98da765567))
* seed backlog.md with initial follow-up tasks ([4cddede](https://github.com/dylanclaywell/drbacklog.md/commit/4cddede4a8a9a6ed84c125a1e91764d774d903f4))
