---
"@fnndsc/cumin": patch
---

cumin: a finished sweep is saved whole. The checkpoint watcher dropped everything the cold sweep emitted (it was not yet current) and ignored the moment the cache became current, so a session whose sweep finished on a quiet CUBE wrote a few shards from later visits and never a roster, and its next boot was cold. Becoming current now writes the roster and every shard.
