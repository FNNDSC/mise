---
"@fnndsc/cumin": minor
"@fnndsc/salsa": minor
---

Feed-DAG data layer. Projects a feed's cached plugin-instance topology into a flat,
surface-agnostic `FeedGraph` and resolves topological-join (`ts`) edges.

- **cumin:** `ProcInstance` gains `pluginType` (authoritative `ts` detection) and
  `joinParentIDs` (cached join overlay); `ProcCache.joinParents_update`/`joinParents_get`
  and `feedInstanceIDs_get` (anchor-tree traversal).
- **salsa:** `feedGraph_build` + `signature_compute` (a per-node topology signature — a
  hash of plugin name plus the sorted child signatures, status excluded — so surfaces can
  group isomorphic siblings without re-deriving the grouping); `feedJoins_ensure` /
  `nodeJoins_resolve` fetch a join node's `plugininstances` parameter and record its extra
  parents (sources minus the anchor).
