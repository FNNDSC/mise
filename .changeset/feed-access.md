---
"@fnndsc/cumin": minor
"@fnndsc/salsa": minor
"@fnndsc/brasa": minor
---

A feed's name and sharing, whole, in the kernel (#853, slice 1). `/proc/jobs/feed_N/title` is writable: its first line renames the feed (`touch --withContents=`, `edit`), and the roster says so at once. `setfacl` speaks every entry CUBE has: `-m u:<user>:r`, `-m g:<group>:r`, `-m o::r` (public) and `-m o::-` (private again); `-x u:<user>` and `-x g:<group>` withdraw a grant (a feed that held none is said). `chmod o+r` / `o-r` is the other entry spelled as a mode. `getfacl` shows users, groups and `other::`. A feed is also named by `/proc/jobs/feed_N`. `feeds share` is retired and refuses by name; SHARE's question no longer says a grant is permanent; the access and tag verbs get a help category. cumin gains `feedAccess_read`, `feedShare_group`, `feedShare_revoke` and `feed_rename`.
