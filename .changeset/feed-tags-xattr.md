---
"@fnndsc/cumin": minor
"@fnndsc/brasa": minor
---

A feed's tags are kernel-covered (#831, slice 1a): cumin's `feedTags_list`, `feedTag_add` (the user's tag of that name, made if missing; idempotent) and `feedTag_remove` (the tagging goes, the tag stays); brasa speaks them as an extended attribute — `getfattr feed_12` dumps them, `setfattr -n tag -v urgent feed_12` hangs one, `setfattr -x tag -v urgent feed_12` takes it off, `setfattr -x tag feed_12` takes every tag off. A feed is named by id, feed_N, a /feeds/ path or /proc/jobs/feed_N; another attribute or flag is refused by name.
