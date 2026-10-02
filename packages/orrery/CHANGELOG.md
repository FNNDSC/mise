# @fnndsc/orrery

## 0.2.2

### Patch Changes

- 92cc3e8: Cleanup, slice 4: the flights a surface asked for as five scene calls round a flag of its own are the scene's words now (`scene/flights.ts`): `frame` (fly to hold nodes), `relight` (a graph held where it stands, part of it framed), `unfold` (nodes settle out from where others stood, the rest frozen, then framed) and `descent` (approach, ask the surface, unfold or stand down), with `moving()` saying whether one is under way. The placement adapters the hand-off and the tubes read live in `scene/drawn.ts`. Unit tests for the flights. No behaviour changes.
- c8ced3b: Cleanup, slice 3: the scene is composed of its parts. `Orrery` (one class of sixty-five methods in an 1,800-line file) now delegates to `scene/settle.ts` (the layouts placed in scene vectors), `scene/wave.ts` (the pulse wave), `scene/replayTrack.ts` (the replay over the star field), `scene/grab.ts` (a node pulled, the molecule's reaction, the ease home), `scene/hover.ts` (the tip and the pick), `scene/hierarchySettle.ts` (the worker protocol), `scene/bodies.ts` (one draw's bodies and edges) and `scene/drawn.ts` (where a drawn node stands); each part reads the scene through a small port and has its own unit tests. The public face is unchanged. `npm run lint:orrery` now also holds every orrery function under 150 lines and every file under 1,200. No behaviour changes.

## 0.2.1

### Patch Changes

- 74eb31e: In the 2D projection a node's disc is drawn on its tubes, not under them: the disc draws after the tubes without the depth test, as a sphere's near hemisphere covers a tube end in 3D.

## 0.2.0

### Minor Changes

- fbd3f0a: The session lays the universe out itself: once the index is whole the daemon runs orrery's engines for every layout in a worker thread and keeps the places (`proc layout <name>` reports `laying` progress meanwhile). orrery is published; `layoutInput_build` builds the engines' input one way for browser and session, and the universe graph builders live in `@fnndsc/menu`. ARGUS waits on the session's progress instead of settling the same space, keeps places only for the view on stage (SHAPES apart), redraws a view already seen where it stood, and gives the session only default-physics places.
