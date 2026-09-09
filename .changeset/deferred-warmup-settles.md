---
"@fnndsc/brasa": minor
"@fnndsc/calypso": minor
"@fnndsc/chell": minor
---

The boot ends at a login. An interactive `chell --daemon` no longer rests on the console face: once the daemon is listening it puts an ordinary `chell --remote --attach` surface on its own terminal, as a child on the wire, so the boot log runs straight into a prompt. `exit` detaches and leaves the daemon running, Enter attaches again, Ctrl-C at the idle terminal stops the daemon, and whatever the daemon writes while a surface holds the terminal is held (calypso `consoleCage_start`/`consoleCage_stop`) and printed on detach. Every chell REPL, local or remote, now guards its idle prompt: a stray line (another surface's output, a late warm-up) lands on its own line with the prompt redrawn beneath it.

The boot readout is lifted with it. A warm-up step running behind the prompt printed its pending row twice and never reported an outcome; it now prints once as `[PENDING]` and settles on the daemon's readout as `[ OK ]` with what it cached or `[FAIL]` with why. Every count takes its noun in the right number (`1 PACS query`, `3 feeds`) through a new brasa `count_noun`. The daemon banner writes every package out in full (brasa `stackBanner_build`/`stackBanner_compose`), adds an ARGUS row when a web surface is served, and drops the welcome; the remote surface banners the daemon's stack the same way. A daemon bound on every interface advertises its fully qualified host name.
