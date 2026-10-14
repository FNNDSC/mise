---
"@fnndsc/menu": patch
"@fnndsc/salsa": patch
"@fnndsc/brasa": patch
"@fnndsc/orrery": patch
"@fnndsc/argus": patch
---

Jump to a feed or a node by its number (#1061). `proc jump 639204` goes to the node, `proc jump feed_4389` to the feed, asking CUBE for anything shared since the roster was walked. A bare number that is both a feed and a node is never guessed: chell names both, and RUNS asks which. RUNS gains JUMP TO on the roster frame: it asks for the number, enters the feed, and selects the node once the graph is drawn, without moving the console's working directory.
