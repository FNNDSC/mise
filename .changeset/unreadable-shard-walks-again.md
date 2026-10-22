---
"@fnndsc/cumin": patch
---

A /proc checkpoint shard that cannot be read or parsed costs its one feed, not the whole checkpoint. On pangea one shard on a failing disk sector (EIO) refused 738 good ones and the session booted cold; now that shard is named as torn (`feed 2291: unreadable (EIO)`), its feed walks again, and the rest restores (#1209).
