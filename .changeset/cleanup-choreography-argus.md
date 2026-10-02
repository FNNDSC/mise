---
"@fnndsc/argus": patch
---

Cleanup, slice 4: the UNIVERSE pane's descent, climb, cluster and plugin framing are one scene word each (`descent`, `frame`, `unfold`, `relight`), and its own `flying` flag is gone for the scene's `moving()`; the DAG pane reads a feed's model into scene nodes through `features/dag/sceneGraph.ts` (`dagGraph_build`, `dagMetric_of`, `hueLegend_build`), pure and unit-tested. No behaviour changes.
