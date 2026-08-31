---
'@fnndsc/calypso': minor
'@fnndsc/chell': patch
---

The console face now covers the whole daemon boot, in two phases.

From warm-up on, the alternate screen shows the brain in a frenetic boot
pulse over a tall strip of the streaming boot log — the messages are the
point while the machine comes up. When the daemon is listening, the same
screen settles in place into the steady instrument: calm ambient pulse,
identity panel, live telemetry, and the closing hint "HIT ESC TO TOGGLE
THE BOOT LOG". Esc toggles to the raw text log in either phase; any key
returns.

Along the way: the log ring now treats a carriage return as a redraw, so a
spinner's thousand frames stay one line; the face steps aside
(`face_suspend`/`face_resume`) when warm-up failure asks the operator a
question, so the prompt's readline owns the terminal; and a boot dying with
the face up flushes the ring — the abort reason included — into the normal
buffer instead of vanishing with it. New calypso API: `face_boot`,
`face_ready`, `face_suspend`, `face_resume`.
