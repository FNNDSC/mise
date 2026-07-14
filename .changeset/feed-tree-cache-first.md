---
"@fnndsc/salsa": minor
"@fnndsc/brasa": patch
---

`feed tree` now builds the DAG **cache-first** from the warm ProcCache instead of
re-crawling the feed on every call. It reuses already-loaded topology, fetches feed
metadata only when missing or a placeholder, refreshes volatile status cheaply (one
feed-scoped list call, active nodes only) when reusing a warm cache, and resolves join
edges lazily. New salsa exports: `feedGraphData_ensure`, `feedMeta_ensure`,
`feedInstances_ensureLoaded`, `feedStatus_refresh`.
