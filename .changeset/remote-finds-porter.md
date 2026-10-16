---
"@fnndsc/calypso": patch
"@fnndsc/chell": patch
---

Attaching with chell --remote now finds the session porter started for you. A script on the same machine can attach to it directly, with no door or token; before, `chell --remote` said "No live calypso" while your session was running. A daemon you start by hand is still allowed beside porter's.
