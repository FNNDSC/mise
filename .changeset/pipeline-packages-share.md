---
'@fnndsc/salsa': minor
---

Registered pipelines gain a durable package store: a warm-up tail sweeps the registry after the topology index settles, fetching only never-seen pipelines and checkpointing identity plus registered manifest to a local CUBE-keyed file. The `/usr/share/packages/<pipeline>` tree serves each pipeline's fields and canonical `manifest.yaml` from that store, and `pipeline diagram` answers from it with no wire traffic at all. The same settlement tail also resolves every unresolved topological-join edge in the background, so a feed's first diagram — however large — renders from cache.
