---
"@fnndsc/brasa": patch
---

Nothing changes at the prompt: listings, globbing, completion and `~` go through the backend's filesystem (#1001). The descriptor gains `vfs` and `completion`. `vfs` holds a fond dispatcher with the backend's mounts, a listing cache, which paths the cache may hold, long-row annotations, unread-link notes and physical paths for globbing. `completion` adds command words, `--options` and the names completed at `/`. The core adds `/usr` and beneath it to the backend's dispatcher. A backend without a filesystem gets the core's own dispatcher and no cache. `/bin` is the ChRIS backend's mount, added as it starts, ahead of `/usr` as before. Globbing and path resolution move into the core. The universe layout moves into `chris/`. `lint:core-deps` drops from 6 to 0.
