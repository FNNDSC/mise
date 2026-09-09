---
"@fnndsc/menu": minor
"@fnndsc/brasa": patch
---

A feed-list row now carries `jobsErrored` (the errored-or-cancelled count, from the proc cache's per-status counters), so a surface can fill an errored feed's progress bar to the work that actually succeeded — `jobsDone - jobsErrored` over `jobsTotal` — rather than run it full in the error hue. The RUNS roster uses it; a full red bar said nothing a red mark would not.
