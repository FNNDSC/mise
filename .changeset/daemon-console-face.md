---
'@fnndsc/brasa': minor
'@fnndsc/calypso': minor
'@fnndsc/chell': minor
---

The daemon terminal gets a resting state: the console face.

The boot-phase brain animation repainted by cursor arithmetic against a
scrolling buffer — counting rows printed beneath it and jumping up — so a
retry warning landing mid-frame interleaved with the art, and the pulse had
to kill itself the moment output scrolled the logo away: the brain went
silent exactly when the daemon came alive.

Boot is unchanged and text-first: the brain prints, pulses while
credentials are checked, and every address and token scrolls into ordinary
scrollback. What is new is what happens when boot completes on a TTY: the
daemon switches to the alternate screen buffer — the same screen vim and
htop own — where the brain pulses forever at fixed coordinates over an
identity panel (identity, wire, ARGUS URL, token, berth, attach line,
uptime, attached surfaces, index counts), with the last few log lines caged
in a dim strip beneath. The pulse is honest: idle is a slow shimmer, an
executing command quickens it, a surface attaching flares it.

Esc or `q` drops to the normal buffer, restored byte-perfect with the boot
log intact and the lines captured while the face was up flushed beneath it;
any key returns. Ctrl-C stops the daemon from either mode. Off a TTY
(systemd, nohup) nothing changes: sequential logging, as before.

The brain art and its frame renderer moved from chell to brasa
(`logo_frameRender`, `logo_linesRender`, and the new `logoRows_count` /
`logoColumns_count`), so any surface can draw it; chell keeps only its
boot-terminal animation host. `daemon_launch` now returns the launched
daemon's addresses and handle, which both launch paths (`chell --daemon`
and the standalone `calypso` binary) feed to the face.
