---
"@fnndsc/chell": patch
---

Logging in from a terminal now works the way GitHub's does. `chell auth login` shows a one-time code and a plain door address (`…/device`) where you enter it while logging in, and it is recognised even behind a host wrapper that puts `--remote --door` in front of every call, which on titan had turned it into a plain door login. A host can name its door for everyone with `CHELL_DOOR`; a user's own default still wins.
