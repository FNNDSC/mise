---
"@fnndsc/argus": patch
---

The RUNNING count clears when a pull ends, and the console echoes the query and retrieve a pane runs. A pull reported each series under `pull:<uid>` and closed the operation under `pull:` with no id, and a per-series retrieve ends in its `status`, not its `phase`, so "1 RUNNING" sat forever; the reconciler now clears an item on a terminal status and clears every key an operation owns when it completes or fails (pure, unit-tested; the same fix in the console cascade). And a query or retrieve fired from a pane button is echoed into the console as the command line it is — the transcript is the whole story of the session, not only of what was typed — then run silently so a long retrieve never locks the prompt; the incidental probes stay silent.
