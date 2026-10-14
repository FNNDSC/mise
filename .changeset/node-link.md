---
"@fnndsc/brasa": patch
"@fnndsc/argus": patch
---

A link opens ARGUS where it points (#1061). `url [path]` in chell prints the door's address with the path as its fragment, LINK on a RUNS graph copies one for the selected node or the feed, and LINK on a FILES row for that folder or file. Opening the link lands there once: a feed or node in RUNS, anything else in FILES, without moving the session's working directory. The door comes from `CHELL_DOOR`; without it `url` prints the fragment and says so.
