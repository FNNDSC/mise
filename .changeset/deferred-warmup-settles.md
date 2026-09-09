---
"@fnndsc/chell": patch
---

Boot readout: a warm-up step running behind the prompt printed its pending row twice, the second copy untagged, and never reported an outcome. The row now prints once as `[PENDING]`, and on a daemon, whose face keeps the boot log, the step settles there as `[ OK ]` with what it cached, or `[FAIL]` with why.
