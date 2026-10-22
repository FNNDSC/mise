---
"@fnndsc/brasa": minor
"@fnndsc/argus": patch
---

A pipeline run answers every node it made, and a run's model says how it settled. `pipeline.scheduled` carries each node's instance, plugin, output folder and status, with the leaves nothing runs off, so `${P.instances.outputPath}` reaches every node and bare `${P}` is the nodes' ids; before, a pipeline passed as one plugin's run with the first id and an empty output path. `run.scheduled` gains `status`, CUBE's word as the run settled or `detached`. ARGUS lights a pipeline's feed as it lights a plugin's (#1208).
