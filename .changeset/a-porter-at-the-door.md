---
"@fnndsc/porter": minor
"@fnndsc/calypso": minor
---

A porter at the door: the mise display manager, slice 3 — the shape without the door.

`apps/porter` logs an operator into one CUBE, trades the password for a token, starts or joins that identity's calypso (`chell --daemon --auth-token-stdin`, the token on stdin, four directories of its own under the porter's state) and mounts the session at `/s/<key>/`: page, assets, `/vfs` and the WebSocket wire proxied to the daemon on loopback with the attach token added by the porter, so the browser holds none. `GET /boot/<key>` streams the session's boot as server-sent events, one per line the daemon wrote, replayed for a late attacher. `POST /sessions` re-checks the password at CUBE every time, even when the session is up.

calypso: the attach token may ride the upgrade URL (`?token=`), the way `/vfs?token=` already does, so a front that holds the token for a browser can put it on the proxied upgrade and the page attaches with an empty one; and `berth_pathIn(runtimeDir, identity)` names a berth under a runtime directory that is not the process's own.

No cookie yet: this porter binds loopback. The door — login page, cookie, LOG OUT — is the next slice.
