---
"@fnndsc/brasa": patch
---

Nothing changes at the prompt: the engine's commands register in two groups, the core ones and the ChRIS ones (#981). `core/coreCommands.ts` holds the commands written over the filesystem and the session (cd, ls, cat, cp, mv, rm, help, exit, the toys and the rest); `chris/chrisCommands.ts` holds everything that speaks to CUBE (identity, feeds, plugins, pacs, upload, download, store and the rest). dispatch registers the core group and the package entry registers the ChRIS one; an explicit order (`core/commandOrder.ts`) keeps every listing, the /bin builtins and tab completion in the order they had. brasa now depends on `@fnndsc/fond` for the item type. `npm run lint:core-deps` counts brasa core files that import cumin, salsa or chili (18) and fails if that number moves without its baseline. The recorded command surface is unchanged and matches.
