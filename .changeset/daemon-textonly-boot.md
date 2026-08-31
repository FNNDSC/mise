---
'@fnndsc/chell': patch
---

A daemon boot keeps its normal buffer text-only, by law.

The boot-phase pulse (revive-and-animate after login) could outlive the
whole boot on a tall terminal, and its final repaint — cursor arithmetic
over wrapped, ANSI-heavy lines — stamped the static brain over the daemon's
token and attach lines, which the console face's Esc view then faithfully
restored, mangled. Daemon mode now skips the revive entirely: the animated
brain lives solely on the face's alternate screen, and the boot report and
addresses survive verbatim for Esc. The interactive chell REPL keeps its
boot animation unchanged.
