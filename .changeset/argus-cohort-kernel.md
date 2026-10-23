---
"@fnndsc/brasa": minor
"@fnndsc/argus": minor
"@fnndsc/menu": minor
"@fnndsc/salsa": minor
---

ARGUS shows the kernel's cohort instead of keeping its own copy. Its GATHER, REMOVE, CLEAR, name and CREATE FEED presses send `gather add|remove|clear|name|feed`, and the band and the GATHER pane redraw from the `gather.cohort` model those verbs answer with, including a line typed at any chell on the session. ARGUS no longer writes `~/gather/current.json`.

The kernel now fills in what the surface used to supply. `gather add` on a PACS path takes the series' description, modality, file count, patient and study from the query answer the path names (from the PACS mount's cache, so at most one CUBE read per query). A gathered folder is imagery when its name or place says it is a series, by the rule ARGUS's viewer uses, which now lives in `@fnndsc/menu` as `seriesFolder_is`. `gather feed [--title T]` makes the cohort's feed: series still at the PACS are pulled first, then one feed is rooted on every member, folders included. `gather name` answers with the cohort, and so does a `pull` that noted landed folders on it.

`PacsVfsProvider.queryResult_fetch` is public, and `vfsDispatcher.pacs` names the PACS mount. `pacsQueryModel_build` moved to `builtins/net/query.model.ts` and is still exported from `query.ts`.
