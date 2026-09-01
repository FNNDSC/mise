---
'@fnndsc/cumin': patch
---

Checkpoint schema v2: execution metrics reach existing caches.

Metrics ride the warmup's list rows — but a v1 checkpoint restores the
topology and settled feeds never re-page, so an existing cache would never
backfill `startedAt`/`finishedAt`/`outputBytes`. The schema bump retires v1
checkpoints: one fresh warmup repopulates with metrics, and the v2
checkpoint carries them from then on.
