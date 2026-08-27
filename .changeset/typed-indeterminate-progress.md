---
'@fnndsc/brasa': minor
'@fnndsc/calypso': minor
'@fnndsc/chell': minor
---

Indeterminate progress now crosses the daemon wire as typed facts rather than
terminal escapes.

The spinner used to write `\r\x1b[K<frame>` and cursor hide/show to the status
channel twelve times a second, so every attached surface received terminal
choreography whether or not it was a terminal — a web surface had to emulate a
character grid to recover the meaning, and got it subtly wrong. It now announces
`operation: 'task'`, `kind: 'inspection'`, `phase: 'working'` with a label, and
closes with `phase: 'complete'`. Each surface draws waiting in its own idiom.

Only state changes cross the wire: frames and elapsed counters are the
renderer's, so a spin of any length costs two events instead of dozens per
second. `chell` gained the elapsed counter its spinner used to bake into the
label, and `argus` gained a full progress renderer — indeterminate work spins,
counted work fills a bar — which also surfaces the download progress it had
been silently discarding.

The `operation` and `phase` enums gained `task` and `working`. Every enum on
the progress message now degrades on an unknown value instead of failing the
parse and dropping the message whole: `operation` to `task`, `phase` to
`working`, `status` to `unknown`, `kind` and `unit` to absent. That makes good
the contract's promise that change within a major is additive — for future
additions, since the fallback lives in the build doing the reading.

The spinner keeps its call signature, so its callers are unchanged. Its
`showTiming` and `clearLine` arguments are now ignored: both are rendering
decisions. It also no longer inspects `process.stdout.isTTY` before announcing,
which had suppressed progress inside the daemon, where the engine's own stdout
is never a terminal but the attached surface may well be able to draw.
