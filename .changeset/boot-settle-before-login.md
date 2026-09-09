---
"@fnndsc/chell": patch
"@fnndsc/calypso": patch
---

Daemon boot leaves no open `[PENDING]` row. The steps that warm behind the prompt were settling after the login took the terminal, which caged them, so their `[ OK ]` never reached the row and it stayed `[PENDING]` on screen. The boot now waits those steps out before the login — they settle in place, every row reading `[ OK ]` or `[FAIL]` — while the daemon is already listening, so nothing reaches it any later for the wait. The startup banner keeps its version column clean: the build hash moves from the CALYPSO row, which it pushed past the column the other rows share, to the `listening` line. The fortune is gone from daemon startup.
