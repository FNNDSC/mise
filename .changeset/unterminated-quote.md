---
"@fnndsc/brasa": patch
---

A line whose quote never closes is now refused instead of run (#1260). `ls 'x; pwd` ran `ls` on `x; pwd` as if the quote closed at the end of the line; now chell says `the ' at column 4 never closes; nothing of the line ran` and exits 2, and no part of the line runs, not a batch's first command or a pipe's first segment. A manifest stops at such a line. A `!` line is the host shell's to read and is not checked.
