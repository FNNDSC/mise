---
'@fnndsc/salsa': patch
---

Everything under a job's `data` link now belongs to the link's target.

`ls /proc/jobs/feed_N/<plugin>_<id>/data` silently re-listed the instance
directory (status, params, log, data) instead of the job's output space, so
a browser rooted at the link showed the wrong entries and built nonsense
paths like `.../data/log` from them. The proc provider now recognizes the
`data` segment anywhere after an instance and delegates the whole subtree —
listing, text reads, and binary reads (new `readBinary`, so images in an
output space render) — to the resolved CFS target path.
