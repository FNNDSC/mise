---
'@fnndsc/chell': patch
---

Two regressions found by running a daemon.

**The boot animation fed its own position counter.** The pulse repaints through
`process.stdout.write`, which is what the row counter hijacks. Counting
newlines it was accidentally safe, since a repaint emits none; counting screen
rows it was not, because each repaint writes thirty lines with no newline and
the pending-column position accumulated. The offset grew by roughly 380 rows a
second, and the logo climbed the screen painting over everything above it. The
animation now writes through the unhijacked handle, and a test asserts the
counter does not move while it runs — against the broken version it moved 762
rows in two seconds.

**Daemon boot showed no spinners.** Warm-up runs before the daemon installs its
own sink, so the engine is still writing to the terminal it is booting in — but
nothing installed a progress renderer there, and the migrated spinner's typed
events went into `StdoutSink`'s null renderer. Before the spinner emitted typed
events it wrote escapes straight to the status channel, so this only appeared
once it stopped doing that, and only in daemon mode. Warm-up now installs a
terminal renderer when the session is interactive.
