---
"@fnndsc/brasa": patch
---

Nothing changes at the prompt: `pwd`, `cd` and `ls` work through the backend's filesystem and no longer reach into CUBE themselves (#1001). The backend's filesystem gains:
- `folder_enter`: how `cd` enters a folder outside the mounts (ChRIS: asks CUBE for it, mapping links and showing its debugging trace as before).
- `structural`: the paths that are always folders.
- `segment_title`: what `pwd --title` shows for a segment (ChRIS: a feed's or plugin's name).

The listing cache gains `cache_invalidate` and `cache_invalidateTree`. A backend without `folder_enter` treats a path that lists as a folder.
