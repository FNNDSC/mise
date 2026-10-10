---
"@fnndsc/brasa": minor
---

Nothing changes in chell or ARGUS: any backend's task can be watched, and ChRIS's feeds are a task source (#983). The core watches a task the backend leaves to it, `/proc/<source>/<id>`, asking its source until the task is over and telling every surface `live`, `settled`, or `stale` when the source cannot answer. The backend's own watch answers first, so ChRIS's feed watch is unchanged. ChRIS's feeds are the `jobs` source: each feed a task named as `/proc/jobs` names it, standing where its jobs do, with its jobs as progress. `/proc/jobs` stays its own mount. CI's core boot watches a fake task settle.
