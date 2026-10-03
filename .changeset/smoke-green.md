---
"@fnndsc/argus": patch
"@fnndsc/cumin": patch
---

Four defects the smoke suite's reds were hiding, fixed. `feed rm` now drops the feed from the session's index at once, so the RUNS roster stops listing a feed this session removed. The RUNS pane records the cwd on every promptline, so a pick is no longer replaced by a stale "move" minutes later. A follow superseded by a hand pick no longer takes the pane when its answer arrives late. RUNS pressed over a graph now leaves the graph whole (watch released, title and canvas cleared), and a feed listing brought by another command no longer pulls the roster over a graph.
