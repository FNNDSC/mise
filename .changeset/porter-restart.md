---
"@fnndsc/porter": minor
"@fnndsc/calypso": minor
"@fnndsc/chell": minor
"@fnndsc/menu": minor
---

A session restarts from its own browser and stays logged in. Porter's new `POST /restart` (cookie-gated: only the cookie's own session) tells the old calypso daemon why, ends it, and boots a fresh one with chell's new `--saved-token` login, which uses the token the identity saved and refuses rather than come up offline. The browser follows the boot on the greeter; a refused saved token ends at the door with the reason. On SIGTERM the daemon sends `closing` (restart, end or stop) to every surface before it exits, and a remote chell prints why it went. `porter --end` leaves `end` as the reason.
