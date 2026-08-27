---
'@fnndsc/calypso': minor
'@fnndsc/cumin': minor
'@fnndsc/brasa': minor
'@fnndsc/chell': patch
---

The wire contract moves out of `calypso` into a package of its own,
`@fnndsc/menu`.

A surface author should depend on the contract, not on the daemon that happens
to serve it. Until now the contract was a subpath of `@fnndsc/calypso`, so a
third-party surface took a dependency on the session host to learn the shape of
a result. `menu` imports nothing from the stack and sits below `cumin`, so both
the engine that produces envelopes and the browser that renders them can load
it.

Two vocabularies the contract narrows to moved with it, because they were
declared above the thing that describes them: the structured-progress values
(previously `@fnndsc/brasa/progress`) and the prompt-facing process-index state
(previously `@fnndsc/cumin/proc-prompt`). Both are re-exported from their old
homes, so existing importers are unaffected; `@fnndsc/cumin/proc-prompt` as a
subpath is gone, and its types are available from `@fnndsc/cumin` directly.

`CommandEnvelope` is now inferred from the schema that validates it. The engine
and the wire previously carried separate declarations of the same shape, tied
together by a compile-time assertion that one stayed assignable to the other; a
single inferred type makes that drift impossible rather than detected.
`@fnndsc/cumin` re-exports the name, so nothing that imports it changes.

`@fnndsc/calypso/protocol` no longer exists as a subpath. Import
`@fnndsc/menu`. The names remain re-exported from `@fnndsc/calypso` itself for
now, since most of the stack has always reached them there.

This is the scaffold for envelope Phase-2 — a typed result model for every
command — recorded in `docs/menu.adoc`. `menu` itself is unpublished until that
work lands, so thirty payload shapes can settle without forcing a release each
time.
