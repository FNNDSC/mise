---
'@fnndsc/chell': patch
'@fnndsc/calypso': patch
'@fnndsc/brasa': patch
---

A stratus or null session greets cleanly: no red `motd` refusal on attach, and no ChRIS packages in its banner.

The greeting asks `motd` with its output scoped away and prints only what `motd` answered, so a backend without one says nothing. A remote line's live output now goes to the sink it was sent from, not whichever is active when it arrives. The daemon's banner and attach answer name chili, salsa and cumin only for a ChRIS session (`versionsForBackend_of`).
