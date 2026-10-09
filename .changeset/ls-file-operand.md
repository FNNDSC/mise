---
"@fnndsc/brasa": patch
---

`ls` on a single file shows it, as POSIX `ls` does: `ls ~/notes.txt` no longer says "Cannot list … No such file or directory". It used to work only while the file's folder happened to be cached. A path that won't list as a folder is now looked up in its parent, and an entry that isn't a folder is the answer. A missing file or folder still fails as before.
