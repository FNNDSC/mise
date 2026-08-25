---
"@fnndsc/cumin": minor
"@fnndsc/salsa": patch
---

Pagination completion: `listPages_drain` joins `listPages_walk` for callers that need a whole collection, and `ListPage` gains an optional `hasMore` hint so a walk survives servers that cap the requested limit. Cumin's own remaining loops (groups, group members, current-user memberships) now ride the shared walker, the peer-store link follower gains a cycle guard and a reported page cap, and the single-shot `limit: 1000` reads in feed resolution, feed comments, workflow creation, and pipeline manifests now drain every page instead of silently truncating at a guess.
