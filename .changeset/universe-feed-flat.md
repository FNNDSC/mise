---
"@fnndsc/orrery": minor
"@fnndsc/argus": patch
---

The UNIVERSE's 3D / 2D block acts on what is in view. Inside a feed it used to flatten the whole galaxy behind the one feed being read; now that feed alone settles flat on the plane through its centre that faces the eye, keeping the spread it had, the camera frames it again, the idle spin rests, and the space behind keeps its depth. Outside a feed the whole space flattens as before. Each feed is entered in 3D; BACK leaves the flat reading with the feed. orrery gains `flat_set(ids)` / `flat_get()` (a new graph ends it) and the `flatPositions_of` layout behind them.
