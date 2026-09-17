---
"@fnndsc/argus": minor
---

ARGUS: `attach` says how to reach this session from a terminal or another browser.

An operator working in the browser who wants a terminal on the same session needs the daemon's URL, port and attach token. The surface already holds all three, since the page reached the daemon by an address carrying the token, so the console now answers for them. `attach` prints the session identity, `chell --remote` for a terminal on the same machine, `chell --remote --attach "<url>"` for one anywhere else, and the browser URL for a second browser. Nothing is asked of the session.

The token is a bearer credential with no expiry, so the readout masks it and only `attach --reveal` prints it. An address on loopback says so, because a second machine cannot reach 127.0.0.1 whatever the token says. Law `a-surface-says-how-to-reach-it` (AEGIS), enforced by the smoke suite in both directions: the masked form never carries the token, the revealed one does.
