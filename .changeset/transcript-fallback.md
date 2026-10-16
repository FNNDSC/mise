---
"@fnndsc/argus": minor
"@fnndsc/calypso": minor
---

The ARGUS console is the terminal wherever the daemon offers one; the transcript is a deprecated fallback for hosts without node-pty. The CONSOLE capsule and `console terminal|transcript` are gone; the transcript shows only where the daemon offers no terminal, and its first line says why (install python, make and g++ and reinstall). `CALYPSO_NO_PTY=1` starts a daemon that offers none, for exercising the fallback.
