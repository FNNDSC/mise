---
'@fnndsc/brasa': minor
---

`pipeline diagram` and `feed diagram` now carry their graphs as typed
envelope models: `pipeline.diagram` (the authored topology) and `feed.dag`
(the live instance graph with statuses and each node's `/proc` data
address). The rendered trees are unchanged; a graphical surface reads the
model where a terminal reads the text — one command, two projections.
