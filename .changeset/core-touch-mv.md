---
"@fnndsc/brasa": patch
"@fnndsc/salsa": patch
"@fnndsc/argus": patch
---

Writing into a missing folder says `No such file or directory`, as on a disk, rather than making the folders. `touch` and `mv` go through the backend's filesystem (#1001). touch writes with the mount's `write`. A file already there is kept as it is when no content is given, and a projected file takes text only. ARGUS makes `~/gather` before it writes the cohort there, and waits for it. mv moves into a folder the destination names, keeping the source's name. It says a missing source by name and passes the mount's refusal on once (CUBE cannot overwrite). The shared helpers (`entry_at`, `folderTree_make`) live in `builtins/fs/entries.ts`. The native mount drains what looking up a missing parent said, as `pathHolders_find` does.
