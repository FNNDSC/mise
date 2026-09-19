---
"@fnndsc/brasa": minor
---

brasa: a verb that starts work waits for it.

A run returned the moment CUBE accepted it, which reads as completion and is not: the next line of a script worked on output that did not exist yet, and the only way to sequence work was a sleep — a lie about time. Running a plugin from `/bin`, `plugin run` and `pipeline run` now wait until every node they scheduled reaches a status it does not leave, and report what happened: how long it took, and which node failed when one did (a failed run exits non-zero, so a script can be believed).

`--detach` asks for the handle instead, which is what these verbs did before; `pull` gained `--detach` as the language's word for the `--nowait` it already had, and still answers to both. A cancellation — Esc at a surface, Ctrl-C at a console — DETACHES rather than kills: the run continues and its handle is printed, which is `--detach` asked for later. Progress goes out on the progress channel throughout, so a surface shows the work moving rather than a frozen line, and losing touch with CUBE is reported as not knowing rather than as failure, because a run whose status cannot be read has not failed.

A pipeline schedules several nodes at once, so a wait is over the SET: it ends when all of them have settled, not when the first does.

Second slice of the manifest work (`docs/manifest.adoc`).
