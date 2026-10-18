---
"bsd-trek": minor
"@fnndsc/menu": minor
"@fnndsc/brasa": minor
"@fnndsc/calypso": minor
"@fnndsc/chell": patch
"@fnndsc/argus": patch
---

A running command can show its surface a typed event, and trek shows its state at every Command: prompt.

`OutputSink` gains `event_write(kind, data)`, the wire gains the `event` message (daemon to the command's origin surface, live only), and the ARGUS client hands events to its host. bsd-trek's `TrekTerminal` gains `state_show`, called with a deep copy of the whole game state before each command is asked for; the session's `trek` sends it as `games.trek.state`. The recorded C games replay unchanged; a terminal that only prints leaves `state_show` out. This is what a bridge that draws the game reads, instead of the printed scans.
