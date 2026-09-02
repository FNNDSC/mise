---
"@fnndsc/cumin": minor
"@fnndsc/chell": patch
---

The `/proc` checkpoint is now a directory of per-feed shards (`~/.cache/chell/proc/<identity-key>/roster.json` + `feed-<id>.json`) instead of one file. A mutation to one feed rewrites only that feed's shard, throttled to one write per 30 seconds per shard with the last change never dropped, so a growing 80k-node feed no longer drags the whole index back to disk on every change; a torn write can damage at most one feed, and a shard whose feed left the roster is ignored on restore. Execution metrics observed on a revisit are now checkpointed too (they previously never triggered a save). A legacy v2 single-file checkpoint is read once and migrated into shards; the old file is left in place for this release. Cache change events now say what they touched (`roster`, `feed`, `all`, `lifecycle`).
