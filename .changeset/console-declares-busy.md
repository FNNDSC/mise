---
"@fnndsc/argus": patch
---

The console says when it is busy: its element wears `data-busy` from the moment a line is submitted until that line's prompt returns, so a line typed meanwhile is known to be queued rather than lost. Nothing on the surface declared this before, and a scenario that typed on a fixed clock asked a pane question in a directory its `cd` had not reached yet.
