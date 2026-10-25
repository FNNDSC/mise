---
"@fnndsc/brasa": patch
"@fnndsc/argus": patch
---

The cohort band redraws when `gather process` or `pull --new-feed` changes the cohort, typed anywhere (#1252). Both commands changed the cohort (its feed, where its series landed) but answered only with their run or the feed they made, so a surface showing the cohort did not learn of it.

Each line still answers with its own result, so `R=$(gather process …)` holds the run and `F=$(pull --new-feed …)` the feed, as before. The cohort goes out on the session bus as well, and ARGUS's ChRIS routes adopt a `gather.cohort` arriving there the way they adopt one a line answers with.
