---
"@fnndsc/chell": minor
---

A terminal comes through the door: `chell --remote --door <url>`.

The porter lets a browser in with a password and a cookie; a terminal can come the same way. `chell --remote --door https://titan/` asks for a username and a password (or takes `-u` and `-p`), logs in at the door once, prints the session's boot rows as it boots if it has to, and attaches to the session's wire — `wss://titan/s/<key>/` — with the door's cookie on the upgrade. No attach token reaches the terminal; the door holds it, as it does for a browser. Same login, same session, same idle rules, from a shell: a `-c` one-shot works too.
