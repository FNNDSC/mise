---
"@fnndsc/menu": minor
---

feat(menu): a PACS answer can say what it did NOT find

`pacs.query` described what a query found and nothing else. That makes the answer an operator usually wants — which of these two hundred MRNs have no imaging — the invisible half of the result.

The model now carries a patient level: every MRN asked, with its status, its study and series counts, the CUBE query that answered for it, and its own provenance.

**Three states, not two.** `found`, `none` and `unasked`. A query that could not be asked is not a query that found nothing, and rendering a timeout as `0` is precisely the confident stale answer the replay work exists to refuse. An unrecognized status from a newer daemon degrades to `unasked`, the only degrade that never reads as an answer this contract never received.

The studies keep their shape and stay on the model, each carrying its own `patientId`. The patient level is not a container for them — it is the record of what was *asked*, which is why it cannot be derived: a miss owns no study.

Provenance is per patient as well as per answer, because a fan-out replays some rows and troubles the PACS for others.

Optional, as `provenance` is: an envelope from a daemon that predates the fan-out still parses, and a surface reads its absence as the single-question case it could only have been.
