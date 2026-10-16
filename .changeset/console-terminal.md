---
"@fnndsc/argus": minor
"@fnndsc/calypso": minor
"@fnndsc/menu": minor
---

The ARGUS console can be a terminal: press TERMINAL on the console's drawer, or type `console terminal`. xterm.js then draws the chell the daemon runs for this page, so the browser console is the same shell as a terminal's, with its own prompt, line editing, history, completion and questions in line with their output. It uses the console's font and colours, and a reload reattaches the same terminal. Touch devices get a key row (ESC, TAB, CTRL, arrows). The choice is remembered per device. A daemon that could not build node-pty offers no capsule, and the console stays the transcript. What ARGUS itself runs, such as a pressed DELETE's `rm -i` with its output and result, is mirrored into the terminal, and the daemon no longer echoes that command to the page's own consoles, so nothing prints twice. A pressed verb's question still stands on its pane, console open or closed, and a question with no pane is shown on a sheet over the stage. The transcript stays the default until the smoke drives the terminal (#1125).
