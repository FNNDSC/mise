---
"@fnndsc/brasa": patch
---

A cohort gathered and pulled from a script reads as home: `expect gather unpulled eq 0` holds and `gather process` runs. Nothing in the kernel recorded where a pulled series landed, so only a cohort built in ARGUS could be processed. `pull` now notes each landed folder on the cohort, and `gather process` and `expect gather pulled|unpulled` ask CUBE for any series member not yet noted. A series gathered from a query's answer (`Series_<uid>_<description>`) now carries its UID (#1226).
