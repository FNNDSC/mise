---
'@fnndsc/brasa': minor
---

`config write <cfs-path> <base64>` — the durable layer's write path.

Per-user surface state (argus desktops, and the config-in-CFS family to
come) lives as files under `~/.config/...` in the user's CUBE home. Reads
were always `cat`; this adds the write: content arrives base64-encoded,
stages through a host temp file, and rides the same upload
(replace-in-place on an existing document) the edit flow uses. Documents
are notes, not datasets: 256KB limit.
