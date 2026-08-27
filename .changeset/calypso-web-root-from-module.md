---
"@fnndsc/calypso": patch
---

The daemon now finds the argus bundle relative to its own module location, not only the working directory. A dev-tree `chell --daemon` launched from anywhere serves the web surface; previously it silently served nothing unless the daemon was started from the checkout root or `CALYPSO_WEB_ROOT` was set by hand.
