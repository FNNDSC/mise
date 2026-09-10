---
'@fnndsc/salsa': patch
---

A retrieve watch measures quiet across the whole study, not per series. A PACS serves a study's series in turn, so every series still queued fifteen seconds after firing had no files and was declared unconfirmed: pulling a whole study reported every series after the first few as lost while pulling one series alone always worked. Silence is now evidence only when nothing has arrived for any series, the long stop counts from a series' first file rather than from the fire, and a reconnection no longer reads as silence.
