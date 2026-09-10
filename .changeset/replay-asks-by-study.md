---
"@fnndsc/cumin": minor
"@fnndsc/brasa": patch
---

A replayed PACS query no longer costs a round trip per series. Reconciling a stored answer against what CUBE already holds asked about every series in turn, two requests each, and held the whole answer back until the last one replied: a patient's history of 299 series took 20.6 seconds against a live CUBE, so a replay — whose entire purpose is not to trouble the wire — felt exactly like a fresh query. CUBE indexes a stored series by its study, so the reconciliation is now one page per study, with file counts fetched only for the series actually home. The same question costs 3.1 seconds. `seriesStorage_resolveMany` is the new bulk resolver; the per-series resolver stays for the paths that need it and for a study the answer cannot name.
