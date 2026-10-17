---
"@fnndsc/cumin": patch
"@fnndsc/brasa": patch
---

A folder made with mkdir -p is there at once for touch, ls and find, its new parents included.

`mkdir -p a/b` makes `a` in the same CUBE step and says nothing of it, so a folder lookup kept as a miss for `a`, and the listings above it, still said it was absent: `touch a/x` answered "No such file or directory" and `find` saw nothing beneath. An invalidated folder now drops the misses kept for every folder above it, and `mkdir -p` forgets each listing above the new folder up to the first that already held its child. The smoke gains a `find` scenario: POSIX order and predicates on a scratch tree, and `/proc/jobs` judged whole from the index with no CUBE request.
