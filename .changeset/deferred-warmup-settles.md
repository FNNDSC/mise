---
"@fnndsc/brasa": minor
"@fnndsc/calypso": patch
"@fnndsc/chell": patch
---

Boot readout lift. A warm-up step running behind the prompt printed its pending row twice, the second copy untagged, and never reported an outcome; it now prints once as `[PENDING]`, and on a daemon, whose face keeps the boot log, settles there as `[ OK ]` with what it cached or `[FAIL]` with why. Every count on the readout takes its noun in the right number (`1 PACS query`, `3 feeds`), through a new brasa `count_noun` helper. The daemon banner writes every package out in full under its own line, backronym and version aligned, with an ARGUS row when a web surface is served, and drops the welcome: that word marks the end of a surface's boot, and a session host has nobody to welcome yet. A daemon bound to every interface now advertises its fully qualified host name in the wire URL, the berth, the attach hint, and the ARGUS address, so a pasted address resolves from another machine.
