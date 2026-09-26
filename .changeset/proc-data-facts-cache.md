---
"@fnndsc/cumin": minor
---

The /proc index can keep what each feed's data is (`ProcFeedDataFacts`: format, and for DICOM the modality and series description), persisted in the feed's checkpoint shard; a shard written before facts existed restores as before, and malformed facts are dropped without losing the feed's topology.
