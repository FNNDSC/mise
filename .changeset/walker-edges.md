---
"@fnndsc/cumin": minor
"@fnndsc/salsa": minor
---

Walker edge hardening from post-merge review. `ListPage` gains `fetchedCount` so a page whose malformed rows were dropped client-side still advances the walk by what the server served, closing a refetch/early-termination gap in `listPageFlexible_wrap`-backed drains; `pluginPipingsPage_get` exposes the piping list with its pagination signals and the manifest and diagram projections use it (the diagram's `limit: 1000` single-shot now drains fully). A shared `collectionPage_wrap` replaces five hand-copied collection-to-ListPage transcriptions. Salsa's pure PACS folder grammar moves to a dependency-free `pacsGrammar` module exposed as the `./pacs-grammar` subpath, so test mocks forward the real functions instead of maintaining copies.
