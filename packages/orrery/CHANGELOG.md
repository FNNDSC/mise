# @fnndsc/orrery

## 0.5.0

### Minor Changes

- bd0af06: A census's connecting lines now carry the pulse wave, so information travels down every connection in a big feed. Past 20,000 connections a census draws lines instead of tubes, and under STARS it always draws threads; both used to sit still and now stream into a live stage and replay a finished run exactly as tubes do.

## 0.4.1

### Patch Changes

- dc75d9b: CENSUS on a feed shells every job again, in RUNS and inside a universe descent, instead of looking like SHAPE. A feed view's nodes are tubed but no longer marked solid, so orrery's census no longer holds them out; the canvas now says how many jobs the census holds (`data-census`).

## 0.4.0

### Minor Changes

- c5e033d: A feed now looks the same from the RUNS roster and from the universe. Either way it is one tree, root on top, every node lit with its tube. Both doors read the feed with one builder, and the universe's descent lays the feed out as that tree and holds it there instead of settling it into a free-form burst. An orrery unfold can now take positions the surface laid out itself (`placed`), held where they are put.
- 71fe8a5: A feed has one frame and one memory, whichever door opens it. RUNS and the universe's descent carry the same verbs (arrangement, 3D, SPHERES/STARS, pulse, metric, hue, census, gravity, and the feed's note, tags and name), and the modes this device last chose stand in both, so a feed switched to MOLECULE in the universe opens as MOLECULE in RUNS. Inside a feed the universe shows the feed's verbs and steps the space-only ones aside; its own draw style comes back on the way out. STARS now works inside a feed: nodes become points of light on fine threads, where before every feed node stayed a sphere. An orrery node can be `tubed` without being solid.

### Patch Changes

- de04249: The scene says whether what it drew stands as a tree, roots on top. After each draw it writes `data-roots-top` on its canvas, beside the fit count, from the lit nodes' heights, so a check can confirm a feed opened as its tree from either door.

## 0.3.0

### Minor Changes

- baec61d: The UNIVERSE's 3D / 2D block acts on what is in view. Inside a feed it used to flatten the whole galaxy behind the one feed being read; now that feed alone settles flat on the plane through its centre that faces the eye, keeping the spread it had, the camera frames it again, the idle spin rests, and the space behind keeps its depth. Outside a feed the whole space flattens as before. Each feed is entered in 3D; BACK leaves the flat reading with the feed. orrery gains `flat_set(ids)` / `flat_get()` (a new graph ends it) and the `flatPositions_of` layout behind them.

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
