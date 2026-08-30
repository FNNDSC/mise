---
'@fnndsc/calypso': minor
---

Instrument traffic stays off the session bus.

A surface's internal commands — a panel's silent listing refresh, an ambient
cycler's pipeline renders — are not things the operator said, yet they were
broadcast to sibling surfaces and retained in scrollback, so a second
attached console printed them live and every reattach replayed them as
noise. The execute message gains an optional `instrument` flag: the daemon
runs the command normally but skips the bus publish and the scrollback
entry, so siblings and replays carry only operator activity.
