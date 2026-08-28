---
'@fnndsc/salsa': minor
'@fnndsc/brasa': patch
---

An archive that cannot run no longer leaves a feed behind, and says the right
reason for not running.

Live testing found both. `download <dir>` from a browser reported that the
`zip v20240311` pipeline was not registered, directly below a line explaining
that one of its nodes was not registered on the target compute environment. The
pipeline was present; the advice to fetch it from the store was wrong. Every
`pipeline_run` failure had been collapsed into the one message.

`pipeline_readiness` in salsa answers whether a pipeline exists and could be
prepared, distinguishing *unregistered* from *registered but unpreparable* —
different problems calling for different actions.

Preparing a pipeline needs no previous instance, so readiness is now checked
*before* the feed is created. The failed run above had already created a feed
that nothing then used, leaving litter in a feed list and a copy in the compute
graph asserting an analysis that produced nothing.

A run that fails after its feed exists now removes it, and names the feed when
removal fails. A run that merely exceeds its time limit is left alone, since it
may yet finish and deleting would remove the feed from under a running job.
