---
'@fnndsc/chell': patch
'@fnndsc/calypso': minor
---

A daemon writes its attach addresses to a file, and keeps its boot animation.

Stopping the brain-activity pulse in daemon mode made the terminal easy to
select from and the session feel dead. The animation stays; the addresses are
written where they can be read without fighting a repainting screen or
surviving a `clear`.

The note lands at `/tmp/calypso-<user>.attach`, and the banner names it. It
carries the attach token, which is a credential, in a world-readable directory
— so it is created `0600`, created exclusively so a symlink planted at the path
makes the write fail rather than land somewhere of an attacker's choosing, and
removed when the daemon exits.

`calypso --berths` reads the same facts from the berth — `0600` in the user's
own runtime directory — and remains the safer route for anything scripted.
