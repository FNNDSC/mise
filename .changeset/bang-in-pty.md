---
"@fnndsc/calypso": minor
"@fnndsc/chell": minor
"@fnndsc/argus": patch
---

Full-screen host programs such as vi, top or your own zsh now work in the ARGUS terminal when host control is on. `!cmd` typed there runs in the terminal's own pty, and Ctrl-C reaches it as an interrupt.
