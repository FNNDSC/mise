---
"@fnndsc/brasa": minor
"@fnndsc/calypso": minor
"@fnndsc/menu": minor
---

A line ended with `&` runs in the background as a joblet, so a long pull no longer holds the console it was typed in. It is kept at `/proc/joblets/<N>` with its output in its log; its surface hears `[1] … &` when it starts and `[1]+ Done`, `Failed (exit N): …` or `Stopped` when it ends. `joblets` lists them, `fg %1` answers what one waits on and follows it, `kill %1` and `wait %1` stop and follow one. A joblet stands where its line was typed with that line's variables, its own `cd`s and assignments staying inside it, and holds what its line changes in the same lane as every line; one that needs an answer pauses until someone brings it forward (#1273).

Every session's runner now carries the core's `joblets` source (a runner source may be `ungated`, needing no tier, and words its own end `notice`, sent to the surface in `data.origin`). An ambient `envelope` event may name its `origin`; calypso sends it to that surface while it is attached. A `Surface` may offer `hold(holds)`, which calypso answers from its lane (`hold_take`). `cwdScope_run` takes a start folder, and a `cd` under one stays in it.
