---
"@fnndsc/orrery": patch
---

Cleanup, slice 3: the scene is composed of its parts. `Orrery` (one class of sixty-five methods in an 1,800-line file) now delegates to `scene/settle.ts` (the layouts placed in scene vectors), `scene/wave.ts` (the pulse wave), `scene/replayTrack.ts` (the replay over the star field), `scene/grab.ts` (a node pulled, the molecule's reaction, the ease home), `scene/hover.ts` (the tip and the pick), `scene/hierarchySettle.ts` (the worker protocol), `scene/bodies.ts` (one draw's bodies and edges) and `scene/drawn.ts` (where a drawn node stands); each part reads the scene through a small port and has its own unit tests. The public face is unchanged. `npm run lint:orrery` now also holds every orrery function under 150 lines and every file under 1,200. No behaviour changes.
