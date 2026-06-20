# Refactoring Status

This file documents the TypeScript refactoring effort to enforce RPN naming conventions and fix codebase consistency.

## Completed Refactoring Tasks

The following files and modules were refactored to adhere to `TYPESCRIPT-STYLE-GUIDE.md` and fix API integration issues:

### File System Commands (`chili/src/commands/fs/`)
1. [x] `ls.ts` (`files_ls` -> `files_list`, relative path fix)
2. [x] `mkdir.ts` (`files_doMkdir` -> `files_mkdir`)
3. [x] `touch.ts` (`files_doTouch` -> `files_touch`)
4. [x] `create.ts` (`files_doCreate` -> `files_create`)

### File Resource Commands (`chili/src/commands/files/`)
5. [x] `list.ts` (`files_doList` -> `files_fetchList`)
6. [x] `delete.ts` (`files_doDelete` -> `files_deleteById`, `files_search` -> `files_searchByTerm`)
7. [x] `fields.ts` (`fileFields_get` -> `fileFields_fetch`)

### Single File Commands (`chili/src/commands/file/`)
8. [x] `view.ts` (`files_doView` -> `files_viewContent`)

### Plugin Commands (`chili/src/commands/plugins/`)
9. [x] `list.ts` (`plugins_doList` -> `plugins_fetchList`)
10. [x] `delete.ts` (`plugins_doDelete` -> `plugin_deleteById`, `plugins_search` -> `plugins_searchByTerm`)
11. [x] `fields.ts` (`plugins_fieldsGet` -> `pluginFields_fetch`)
12. [x] `add.ts` (`plugins_add` -> `plugin_add`)
13. [x] `overview.ts` (`plugins_doOverview` -> `pluginsOverview_display`)

### Single Plugin Commands (`chili/src/commands/plugin/`)
14. [x] `readme.ts` (`plugin_doReadme` -> `pluginReadme_fetch`)
15. [x] `run.ts` (`plugin_doRun` -> `plugin_execute`)
16. [x] `search.ts` (`plugin_search` -> `pluginIds_resolve`)

### Feed Commands (`chili/src/commands/feeds/`)
17. [x] `list.ts` (`feeds_doList` -> `feeds_fetchList`)
18. [x] `delete.ts` (`feeds_doDelete` -> `feed_deleteById`, `feeds_search` -> `feeds_searchByTerm`)
19. [x] `fields.ts` (`feeds_fieldsGet` -> `feedFields_fetch`)
20. [x] `share.ts` (`feeds_doShare` -> `feed_shareById`)

### Single Feed Commands (`chili/src/commands/feed/`)
21. [x] `create.ts` (`feed_doCreate` -> `feed_create`)

### Connection Commands (`chili/src/commands/connect/`)
22. [x] `login.ts` (`login_do` -> `connect_login`)
23. [x] `logout.ts` (`logout_do` -> `connect_logout`)

### Manual Pages (`chili/src/commands/man/`)
24. [x] `doc.ts` (`manpage_handle` -> `manPage_display`)
25. [x] `topics.ts` (Verified RPN)

### Handlers & Utils
- `chili/src/filesystem/fileGroupHandler.ts` (Updated imports/methods)
- `chili/src/plugins/pluginHandler.ts` (Updated imports/methods)
- `chili/src/feeds/feedHandler.ts` (Updated imports/methods)
- `chili/src/utils/cli.ts` (`path_resolve_chrisfs` -> `path_resolveChrisFs`)
- `chili/src/utils/docker.ts` (Renamed methods)

### Chell (New Module)
- `chell/src/index.ts` (Refactored to RPN, Added JSDoc/Types)
- `chell/src/core/repl.ts` (Created, RPN/JSDoc/Types)
- `chell/src/session/index.ts` (Created, RPN/JSDoc/Types)
- `chell/src/builtins/index.ts` (Created, RPN/JSDoc/Types)
- `chell/src/lib/vfs/vfs.ts` (Created, RPN/JSDoc/Types)
- `chell/src/config/settings.ts` (Created, RPN/JSDoc/Types)

## Other Fixes
- `Makefile`: Fixed bootstrapping for `scrub`.
- `cumin`: Fixed `errorStack` missing export and syntax.
- `salsa`: Fixed aliasing style violations (`salsa_` -> `salsaModule_`).
- `chell`: Implemented MVP with direct connection, relative path support, and fallback to `chili`.