---
'@fnndsc/calypso': patch
'@fnndsc/chell': patch
---

The daemon boot experience, settled: classic boot, minimal face.

Booting is the classic in-scroll experience again — the brain lights up at
connect and the boot log with its in-stage progress scrolls beneath it
(frames now paint as one buffered write, so concurrent log lines cannot
tear the art). When the daemon is ready, the boot screen is replaced by a
minimal console face on the alternate buffer: the animating brain,
vertically centered, one status line (DAEMON RUNNING · SESSION ESTABLISHED,
or ENGINE EXECUTING while a command runs), and the Esc hint. Nothing else.
Esc shows the verbatim text record — boot log, addresses, token — which the
ready handoff now halts the pulse without repainting, so it can never again
be stamped over; any key returns to the brain.
