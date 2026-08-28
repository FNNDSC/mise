---
'@fnndsc/chell': patch
'@fnndsc/calypso': minor
---

A daemon's terminal stops repainting itself, and its attach addresses can be
read back.

`logo_animatePulse` starts a 100ms interval that saves the cursor, jumps up the
screen, repaints the logo and restores — and it runs for as long as the process
does. The interactive path stops it once boot finishes; the daemon path never
did. So a daemon's terminal was being rewritten ten times a second forever,
which made the banner it had just printed — the URLs and the attach token, the
only thing anyone needs from that terminal — impossible to select.

`calypso --berths` prints how to attach to every live daemon: the ARGUS link
and the ready-to-paste `chell --remote --attach` command, per identity.

The facts are read from the berth rather than copied to a more convenient
place. A berth already holds the url and token at mode `0600` in the user's
runtime directory; `/tmp` would be easier to reach and is world-readable, and
the token is a credential.
