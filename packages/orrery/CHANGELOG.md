# @fnndsc/orrery

## 0.2.1

### Patch Changes

- 74eb31e: In the 2D projection a node's disc is drawn on its tubes, not under them: the disc draws after the tubes without the depth test, as a sphere's near hemisphere covers a tube end in 3D.

## 0.2.0

### Minor Changes

- fbd3f0a: The session lays the universe out itself: once the index is whole the daemon runs orrery's engines for every layout in a worker thread and keeps the places (`proc layout <name>` reports `laying` progress meanwhile). orrery is published; `layoutInput_build` builds the engines' input one way for browser and session, and the universe graph builders live in `@fnndsc/menu`. ARGUS waits on the session's progress instead of settling the same space, keeps places only for the view on stage (SHAPES apart), redraws a view already seen where it stood, and gives the session only default-physics places.
