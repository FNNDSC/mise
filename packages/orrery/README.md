# @fnndsc/orrery

The model of the heavens a surface draws. An orrery is the geared model of the sky on a desk: gearing computes where each body stands, brass spheres show it, a crank sets it turning. This package is that instrument for ARGUS's universe and DAG views, in three layers kept strictly apart, and a scene that composes them:

- `layout/` — the gearing. Pure engines (graph in, positions out), no renderer, run in a worker and tested in jest.
- `draw/` — the spheres. Draws positions with an encoding; knows nothing of layouts or the camera.
- `controls/` — the crank. Camera rig and flights, pointer gestures, picking.
- `scene/` — the instrument assembled: `Orrery<N>`, one three.js space a surface mounts, handed nodes with a look (state, a named paint, ember, waved), a palette and optionally a layout worker; every pick hands the surface its own node back.

orrery knows nothing of ChRIS: a surface translates its own domain into orrery's encoding (ARGUS does it once, in `apps/argus/src/scene/chrisLook.ts` and `chrisSpace.ts`). The layers' imports are enforced in CI (`npm run lint:orrery`). Design and journal: [docs/orrery.adoc](docs/orrery.adoc).

Private to the mise workspace until something besides ARGUS uses it.
