---
"@fnndsc/argus": minor
"@fnndsc/calypso": minor
"@fnndsc/chell": minor
"@fnndsc/menu": minor
---

The ARGUS console is now a terminal by default wherever the daemon offers one; TRANSCRIPT on its drawer goes back. A browser's terminal can no longer run anything on the daemon's host. Its chell used to declare that it could, so `!cmd`, host pipe segments, `edit` and `download` would have run on the daemon host. These requests now go to the browser that owns the terminal, which refuses `!` and host pipes by name, opens its own editor pane and saves downloads in the browser. Questions stay in the terminal. A terminal's chell marks for the page whether it is at its prompt, running a command or asking, and the page shows it as `data-terminal-state`. Ctrl-C at an open question now abandons it, so the command that asked is told and ends. Commands typed in the page's own terminal move the page as its console's commands always did: a game opens the GAMES pane, `say` speaks and a `cd` re-lists the files pane. An answered pane question is recorded in the terminal's scrollback. A line the terminal wrapped reads back as one line. The smoke suite drives either console (`SMOKE_CONSOLE=terminal|transcript`), and the nightly gains a transcript lane (#1125).
