---
'@fnndsc/calypso': patch
---

A daemon's console runs the chell installed beside it, not whichever chell the path finds first. A stratus session, and the calypso binary, spawned the console from `chell` on the path, so on a host whose path leads to another install the console greeted with "This chell and the calypso daemon are different builds" and a host with no chell on the path had no console at all. Calypso now resolves `@fnndsc/chell` from its own install and runs that entry under its own node; a daemon that passes its own launch (chell's) is unchanged, and the path remains the fallback where no chell is installed beside calypso.
