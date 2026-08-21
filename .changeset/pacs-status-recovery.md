---
'@fnndsc/cumin': minor
'@fnndsc/brasa': minor
---

Make PACS pulls observable and recoverable. A new `pacs status <expression | path | queryId>` reports one line per series: a fill bar of files registered in CUBE against the PACS-reported instance count, the derived state, and the in-CUBE `/SERVICES` folder for every landed series; an expression reuses the caller's most recent matching query instead of minting a new record per check. `pull` is now idempotent: series already fully registered in CUBE are skipped before firing, so re-running the same pull fetches exactly the missing series. Retrieve firing gets three attempts with backoff and is bounded to four concurrent creations, replacing the all-at-once stampede that overloaded CUBE and silently lost retrieves. A series whose firing still fails is reported as `FAILED TO FIRE, will not arrive; re-run pull`, distinct from watch-side failures, which now point at `pacs status` since their transfers usually complete server-side anyway. Cumin's status report gains the per-series storage folder (`seriesStorage_resolve`). The failure modes and operator playbook are documented in docs/pacs-pull-recovery.adoc.
