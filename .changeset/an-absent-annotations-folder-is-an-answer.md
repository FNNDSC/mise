---
"@fnndsc/salsa": patch
---

salsa: an absent annotations folder is an answer, not a fault.

Summarizing a series looks for annotations under the series UID. Most series have none and the folder does not exist, which the summary already handled — but the failed listing was left on the error stack, and the dispatch boundary reads a command that leaves errors behind as a command that failed. So `dcm series` printed a complete, correct readout and exited non-zero.

Found by playing a manifest: a workflow that reads a header stopped dead on a line that had just worked. The lookup now drains the miss it went looking for.
