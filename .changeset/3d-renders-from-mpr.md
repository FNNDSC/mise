---
"@fnndsc/argus": patch
---

The 3D layout renders when reached from MPR, not only when reached from a single stack. The volume is cached under the engine's id, so the MPR build loaded it there and a following 3D build got the already-loaded volume back with no streaming events to first render on — a black field, the operator's "select 3D, nada", seen only from MPR because a first 3D built the volume itself. The volume is now purged before each build so every layout renders as the first, and the 3D camera is framed explicitly rather than left to load events.
