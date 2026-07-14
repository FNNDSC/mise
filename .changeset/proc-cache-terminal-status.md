---
"@fnndsc/cumin": minor
"@fnndsc/salsa": minor
"@fnndsc/brasa": patch
---

/proc now caches settled job status. A finished plugin instance
(`finishedSuccessfully`, `finishedWithError`, `cancelled`) never changes, so its
status is kept permanently once observed. Consequences:

- Listing a fully-finished feed under `/proc/jobs` is instant — no status calls.
- Live status for active feeds is refreshed with a single feed-scoped list call
  (the list response already carries `status`) instead of one detail fetch per node.
- Reading a settled instance's `status` returns the cached value without an API call.
