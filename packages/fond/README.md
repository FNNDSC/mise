# @fnndsc/fond

The neutral base under mise's engine (`brasa`) and session host (`calypso`): *fonds de cuisine*, the base stocks a kitchen cooks everything from.

It holds what is generic and once lived in a ChRIS package, so a layer that is not about CUBE can use it without loading CUBE's client:

* `Result`, `Ok`, `Err`, `result_isOk`, `result_isErr`: explicit success or failure.
* `errorStack`: the process-wide, async-context-aware message stack.

Later steps of the backend-neutral work add the VFS framework and the output sink and surface interfaces. See [docs/backend-neutral.adoc](../../docs/backend-neutral.adoc).

fond depends on nothing in `@fnndsc`. `@fnndsc/cumin` re-exports what moved here, so existing imports keep working.
