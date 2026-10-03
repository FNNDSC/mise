---
"@fnndsc/menu": minor
"@fnndsc/brasa": minor
"@fnndsc/calypso": minor
"@fnndsc/argus": minor
---

An edit crosses the wire to a browser (#831, slice 2). The daemon's `edit` request now names the file being edited (`path`), and a surface may answer `opened`: it took the file into an editor that stays open, so the command saves nothing and says `(opened in the editor)`; each save made in that editor will run as its own command line. The argus client hands an edit to a host editor hook and answers at once that it opened, or refuses in words when it has none (the hook is installed by the editor pane, slice 3). `feed note edit N` is now `edit /proc/jobs/feed_N/note`: a terminal's editor and a browser's pane open the same text and save it the same way, and the title is set with `feed note N --title`.
