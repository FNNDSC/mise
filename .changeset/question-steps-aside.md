---
"@fnndsc/calypso": minor
"@fnndsc/brasa": minor
---

A command waiting on a question no longer freezes the session; other commands run until it is answered. While its question (or an editor) is open, other surfaces' commands run, and it takes its turn again when answered. Before, a trek waiting for a move, an `rm` waiting for "y" or a PACS confirm froze every pane verb and every other terminal until it was answered, or until an abandoned terminal was cleaned up. The daemon's queue is now a lane that a command gives up while it waits on a person and queues for again after the answer, resuming with its own routing. Brasa hands over each command's own state at the same two points: its exit code, a pipe's untaken input, a `play` manifest's depth, the recorder's mute and the Ctrl-C target. Each top-level line keeps its own error stack. Commands that ask now fix their targets before asking, so a `cd` from another surface cannot redirect the answer. `rm` resolves every operand first, `mv` and `cp` fix their sources, and a relative destination or PACS export path lands where the session stood when it asked (#1128).
