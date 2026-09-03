---
"@fnndsc/cumin": patch
"@fnndsc/salsa": patch
---

The session-state context (working directory, feed, plugin, PACS server) is owned by the process once loaded: its files are written for the next process to restore from, never re-read mid-session. Two daemons of one identity shared a working directory through `cwd.txt`, and a `cd` in one moved the other. Identity (user, URL) still reads from storage; a connect reloads everything.
