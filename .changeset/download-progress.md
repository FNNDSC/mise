---
"@fnndsc/calypso": minor
"@fnndsc/argus": patch
---

A download shows how far it has got, from the press to the end. A transfer row stands at the foot of the screen at once: waiting for CUBE, then bytes of the whole with the rate and the time left, then done, failed with CUBE's reason, or cancelled, with CANCEL to stop it. The daemon counts the bytes it passes (`/vfs?progress=<id>`, `cancel=<id>`) and holds the probe's stream for the browser's save, so CUBE is asked once instead of twice.
