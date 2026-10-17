---
"@fnndsc/fond": minor
"@fnndsc/salsa": minor
"@fnndsc/brasa": minor
---

Questions about runs are now answered from the session's job index with find over /proc/jobs, asking CUBE nothing. -plugin and -status test what a job ran and how it ended, so find /proc/jobs -plugin pl-dylld -status finishedWithError lists every failed run. A mount can answer a whole subtree for find; /proc/jobs does.
