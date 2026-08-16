---
'@fnndsc/brasa': patch
'@fnndsc/chili': patch
'@fnndsc/salsa': patch
'@fnndsc/chell': patch
---

Make CUBE group membership commands name-first and batch-capable. `group members`, `group inspect`, `group adduser`, and `group removeuser` now accept an exact group name or a numeric ID; add and remove accept multiple usernames, report every result, and make already-satisfied membership changes successful no-ops.
