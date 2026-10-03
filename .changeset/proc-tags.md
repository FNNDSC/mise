---
"@fnndsc/cumin": minor
"@fnndsc/salsa": minor
"@fnndsc/brasa": minor
---

Tags are a vocabulary of folders under `/proc/tags` (#831, slice 4a). `ls /proc/tags` lists your tags (an unworn one too); `ls /proc/tags/<tag>` lists the feeds wearing it as links to `/proc/jobs/feed_N`, and `cd` through one lands in the feed. `mkdir /proc/tags/<name>` makes a tag, `rmdir` deletes one no feed wears ("Directory not empty" otherwise), and `mv` renames one. `setfattr -n tag -v <name>` no longer makes a tag: naming one that does not exist is an error naming the cure (`mkdir /proc/tags/<name>`). `rm` under `/proc/tags` is refused and names the verb that does the job. New builtin `rmdir` (empty folders only, as on Linux, on the store and in projections); `mkdir` and `mv` route a projection's paths to it, and a projection that makes or renames nothing refuses by name ("Read-only file system", "Invalid cross-device link"). The old read-only `/tags` projection is retired. cumin gains `tags_index`, `tag_create`, `tag_delete`, `tag_rename` over one cached index of the user's tags and their feeds.
