---
"@fnndsc/chell": patch
---

Fix `exit` from a remote surface tearing down the whole CALYPSO daemon. The REPL now treats `exit` as a shell-quit at the surface layer (closing readline) instead of forwarding it to the engine; for a `chell --remote` surface this detaches the client while the daemon — and any other attached surfaces — keep running. Previously `exit` reached the daemon's dispatch and called `process.exit`, killing every surface. Local interactive `exit` is unchanged apart from now printing the same goodbye line as Ctrl-D.
