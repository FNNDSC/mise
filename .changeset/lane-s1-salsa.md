---
"@fnndsc/salsa": minor
---

feat(salsa): index movement never holds the lane — `feedInstances_ensureStarted` starts a cold feed's topology walk and returns `pending`, the walk runs detached and deduped, a failure is named in the load register, and `feedGraphData_ensure` reports readiness instead of waiting
