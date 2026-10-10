---
"@fnndsc/brasa": patch
"@fnndsc/salsa": patch
---

A refused removal names what the path is, where it had said `No such file or directory`. `rmdir` of a file says `Not a directory`, `rm /proc/jobs` says `Read-only file system`, and `rm /bin` says `virtual /bin directory`. `rm` and `rmdir` go through the backend's filesystem (#1001). rm removes a file or link with the mount's `rm`, and a folder only with `-r`: with `rmTree` where the mount offers it, else entry by entry, deepest first. Nothing there is fine under `-f`. A projection's path is its mount's to remove or refuse. The /proc/tags hints (setfattr untags a feed, rmdir deletes a tag) and the /bin refusal move into those mounts, so the core names neither. rmdir asks the mount's `rmdir`. The ChRIS-only folder probe (`folderExists.ts`) goes.
