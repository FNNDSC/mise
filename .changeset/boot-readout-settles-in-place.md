---
"@fnndsc/brasa": minor
"@fnndsc/chell": minor
---

Boot readout, second pass. A step that starts as `[PENDING]` (or falls to `[RETRY]`) is now rewritten in place when its outcome lands, the way a boot screen settles a row rather than repeating it beneath, so a settled step leaves one `[ OK ]`/`[FAIL]` row and no open pending row. The brain animation and the readout now share one stdout row counter, so neither miscounts the other's scrolling; a row that has scrolled off the screen, or an outcome taller than the pending row it replaces, appends as before. The daemon banner paints each package in three parts (its name bright, the rest of its backronym plain, the version dim in one column) and carries the build hash on its own CALYPSO row, so the redundant headline line is gone; a remote surface paints the daemon's stack the same way.
