---
"@fnndsc/orrery": patch
---

Cleanup, slice 4: the flights a surface asked for as five scene calls round a flag of its own are the scene's words now (`scene/flights.ts`): `frame` (fly to hold nodes), `relight` (a graph held where it stands, part of it framed), `unfold` (nodes settle out from where others stood, the rest frozen, then framed) and `descent` (approach, ask the surface, unfold or stand down), with `moving()` saying whether one is under way. The placement adapters the hand-off and the tubes read live in `scene/drawn.ts`. Unit tests for the flights. No behaviour changes.
