---
"@fnndsc/argus": minor
"@fnndsc/brasa": minor
"@fnndsc/chili": patch
---

feat: SELECT is a mode, and a selection has verbs

A mode describes how the field behaves, and this one changes what a click means. While SELECT is on a click gathers a row instead of indicating it, row verbs stand down — a row is not indicated then, it is selected — and the bar reads `SELECT · 2 SELECTED`, adding `· 1 SHOWN` when a filter hides some of what was gathered, since a verb acts on the selection and not on what is on screen.

The selection belongs to the **field**: it survives a filter (which is how a selection gets built in a folder of hundreds) and the same rows arriving again; it is cleared by navigation, because a selection that follows the operator elsewhere is one they can act on without seeing; and leaving the mode clears nothing. Esc leaves SELECT before it retreats anywhere — but never while a question is open, since abandoning a question is an answer and one press must not answer two things.

Its verbs ride the frame, and each is ONE command the operator could have typed:

* `rm -rI "a" "b"` — **new `-I`**: one question for the whole list, naming how many, rather than one per file. A refusal removes nothing at all; there is no half of a set.
* `mv -t` / `cp -t` — **new `-t <dir>`**: names a target directory so every operand is a source, and given no value it asks, wanting a directory.
* `setfacl` over the **distinct feeds** the selection touches, which asks who once for the set.

## A defect this bought, and the guard for it

The live run found the surface lowering a two-file selection to `mv a b` — which the shell correctly reads as "rename a onto b", and which moved one file of the pair onto the other. Chasing it turned up something worse and older: **a move onto a path the store already holds leaves a row CUBE's own API cannot serve, and one such row makes every listing of that folder fail** — the poisoning first seen in #462, now reproducible in three commands.

`mv` refuses that move by name instead of attempting it, which costs one listing call and keeps the folder readable, and a failed move now reports the reason the kernel gave rather than a bare "Failed to move".

Also: a browser re-lists after a verb that changed the folder it is showing (`fs.rm`, `fs.mv`, `fs.cp`) — `rm` reports what it removed, not where it removed it from, and a listing that keeps showing rows that are gone is a listing lying about the store.
