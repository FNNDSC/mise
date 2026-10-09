---
"@fnndsc/brasa": patch
---

A file you name to `ls` is listed, as POSIX ls lists it, instead of "Cannot list … No such file or directory". `ls ~/notes.txt` works. It used to work only while the file's folder happened to be cached. A path that won't list as a folder is now looked up in its parent, and an entry that isn't a folder is the answer. A missing file or folder still fails as before.
