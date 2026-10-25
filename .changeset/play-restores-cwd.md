---
"@fnndsc/brasa": patch
---

A play now hands back the working directory it began in when it ends (#1264). A manifest that does `cd ${FEED.path}` to run a pipeline from that node no longer leaves the shared session, and every surface on it, standing inside the feed. The directory is given back however the play ends: at its last line, at a refused line, at a `--pace` stop, or when interrupted. Inside the play a `cd` holds as usual, and a `--dry-run` moves nothing.
