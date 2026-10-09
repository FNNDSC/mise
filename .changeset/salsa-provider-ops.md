---
"@fnndsc/salsa": minor
---

Nothing changes at the prompt: salsa's CUBE mount answers every filesystem operation, held to fond's contract (#1001). It now offers read, readBinary, write (which replaces), mkdir, rmdir, rename, rm and rmTree, each failing with the errno a disk would give. CUBE's own words carry over as the reason: its "File not found", and its refusal to overwrite on rename. A test runs fond's `VFS_CONTRACT` against the mount with CUBE faked in memory. The core's file tools move onto these operations next.
