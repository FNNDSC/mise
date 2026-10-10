---
"@fnndsc/menu": minor
"@fnndsc/calypso": minor
"@fnndsc/argus": patch
---

Nothing changes on screen: the daemon's attach answer names the session's backend, and ARGUS reads it (#985). menu's `attached` message gains an optional `backend`; calypso fills it from the backend it hosts (`chris`, `null`). ARGUS's `attachBackend_get` reads it, and an older daemon without the field is ChRIS, so a new ARGUS against an old calypso draws what it always drew.
