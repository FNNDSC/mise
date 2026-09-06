---
"argus": minor
---

feat(argus): the MRN is the outermost level, and a miss is an answer

The PACS listing gained its patient level — always, not only when a cohort was asked. Every patient asked gets a row, hits and misses alike, because the MRNs that come *back* are by definition the ones with imaging, which makes the answer an operator usually wants — which of these two hundred have none — the invisible half of the result.

Three states, distinguishable at a glance: a hit reads its counts, a miss reads `0` with a dim track, and a row nothing could be asked of reads `UNASKED` in the mars hue, its reason on the title — never a zero, because a zero says the PACS answered, which is the one thing a timeout did not do. The pane's bar carries all three as `FOUND 2 · NONE 2 · UNASKED 0`, derived from the rows so the summary cannot disagree with what is on screen.

**ANSWERED is a column.** A fan-out replays some rows and troubles the PACS for others, so provenance is per row; sorting on it lifts the stale rows to the top, and a row with no answer sorts to the far end rather than pretending to be old.

**Progress sums at this level too** — every series under a patient, added and never averaged — and a level holding one row opens itself at every level, so an accession query still costs no gesture while a cohort arrives folded.

Two things the live run settled:

* The FILTER pill read the *study* order's strip while toggling the outermost one, so it reported OFF with the strip standing open.
* The study level is not indented. The form's DATE, ACCESSION and MODALITY fields stand over the study caps, and an indent pushed those columns 26px out from under the fields that fill them; the nesting is said by an inset shadow, which costs no horizontal space.

Law `a-set-says-what-became-of-every-member`, smoke-enforced (`SMOKE_PACS_COHORT`), alongside five new scenarios over a live cohort.
