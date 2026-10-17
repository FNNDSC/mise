---
"@fnndsc/argus": patch
"@fnndsc/chell": minor
"@fnndsc/brasa": patch
---

The terminal console's text is the old console's size again, and a new clear command empties the console. The terminal had taken the page's larger size because xterm measured it before the console's styles applied. clear empties the screen and scrollback in a terminal and the record in the transcript; Ctrl-L still clears the screen alone.
