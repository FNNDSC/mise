---
"@fnndsc/calypso": minor
"@fnndsc/chell": patch
---

The standalone `calypso` binary ends its boot at a login, like `chell --daemon`: on a TTY the daemon's own terminal becomes its first surface, an ordinary `chell --remote` spawned onto it, rather than the old resting face. The console loop, the cage and the reattach grammar move into calypso (the daemon's own package), with the surface launch injected — chell spawns itself, the calypso binary spawns `chell` from the path — so both hosts share one console. Off a TTY neither attaches; the daemon just keeps listening.
