---
'@fnndsc/stratus': patch
---

Reading capacity or spend no longer holds the session, so a console attaching mid-read gets its prompt at once. The limits `capacity` reads are kept for ten minutes and read four at a time, so a repaint or the CAPACITY pane answers from what was read.
