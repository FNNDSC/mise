---
'@fnndsc/salsa': patch
---

Pipeline diagrams are cached per client keyed by pipeline id (registered pipelines are immutable, so the first build is the only CUBE traffic a diagram ever costs a session), and a fully settled feed's diagram now renders from the process cache with no status refresh at all — the refresh runs only while some instance can still change.
