---
"@fnndsc/cumin": minor
"@fnndsc/salsa": minor
"@fnndsc/brasa": minor
---

The job index keeps which pipeline run made each job, and find asks it with -pipeline and -workflow, CUBE never asked.

Each `/proc/jobs` job keeps its CUBE row's `pipeline_name` and `workflow_id` (a job run directly keeps null), saved in the checkpoint. Jobs restored from an older checkpoint are read again once, feed by feed on six lanes, behind the prompt. `find /proc/jobs -pipeline 'FreeSurfer*'`, `-pipeline ''` (a direct run) and `-workflow ID` answer from the index; a job whose run is not known yet is not judged, and `find` names how many on stderr instead of dropping them silently.
