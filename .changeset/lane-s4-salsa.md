---
"@fnndsc/salsa": minor
---

feat(salsa): `procRoster_syncStart` starts the roster sync and returns at once, deduped with a sync in flight and named in the cache while it runs; `procRoster_sync` still waits for callers that must
