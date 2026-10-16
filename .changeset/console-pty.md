---
"@fnndsc/calypso": minor
"@fnndsc/menu": minor
"@fnndsc/chell": patch
---

The daemon offers terminals: a browser's console can be a real chell, run under a pseudo-terminal. A surface sends `terminalOpen` with its size and receives the terminal's bytes as `terminalData`; it sends keystrokes back as `terminalInput`, and size changes as `terminalResize`. Each terminal is the same `chell --remote` a shell would run, attached back to this daemon over loopback. A terminal outlives the socket that opened it: opening it again by its id replays up to about 1 MB of recent output and carries on, even mid-command or mid-question. A terminal nobody is attached to closes after 15 minutes, and `exit` closes it at once. The pseudo-terminal comes from `node-pty` 1.1.0, an optional dependency compiled at install. A daemon where it did not build says `terminals: false` on attach and refuses `terminalOpen` with the reason. ARGUS's console moves onto this in the next release (#1125).
