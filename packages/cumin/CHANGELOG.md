# @fnndsc/cumin

## 3.6.0

### Minor Changes

- 0d358c5: /proc now caches settled job status. A finished plugin instance
  (`finishedSuccessfully`, `finishedWithError`, `cancelled`) never changes, so its
  status is kept permanently once observed. Consequences:

  - Listing a fully-finished feed under `/proc/jobs` is instant — no status calls.
  - Live status for active feeds is refreshed with a single feed-scoped list call
    (the list response already carries `status`) instead of one detail fetch per node.
  - Reading a settled instance's `status` returns the cached value without an API call.

## 3.5.0

### Minor Changes

- aa81b0a: Add the error stream to the envelope contract and convert the first fs builtins. `CommandEnvelope` gains `renderedErr` (printable stderr text, ANSI permitted), keeping the error stream separate from pipeable data; `envelope_error` accepts it as a third argument; the structured `errors` field is machine-facing and no longer presented by delivery. chell's `OutputSink` gains `err_write` (stdout sink routes to stderr; capture sink passes through uncaptured, matching today's pipe semantics). Builtins converted: `cd`, `mkdir`, `touch` (models `fs.cwd`, `fs.mkdir`, `fs.touch`), rendered and error-stream bytes identical to the previous behavior.
- 2099ff6: Make the error stack async-context aware and drain it per command. cumin's `errorStack` gains `scope_run` (run work against an isolated stack), `checkpoint_mark`, and `checkpoint_drain`: fire-and-forget background work (topology warm-up, background cache refresh) now runs inside its own scope so its error traffic cannot land in a concurrent foreground command's drain window. chell's dispatch checkpoints the stack before each command and drains anything pushed above the checkpoint into the envelope's `errors` field, escalating status to `error` when a genuine error was left on the stack — a reliable per-command failure signal that also retires the exit-code-delta status heuristic's blind spot (a later failing batch segment no longer reads `ok`). CLI behavior is byte-identical.
- c47ff22: Add the command result envelope (`CommandEnvelope`, `EnvelopeModel`, `ResolutionTrace`, `envelope_ok`, `envelope_error`, `envelope_isOk`): the typed container in which a command's outcome travels from execution to its host, carrying rendered terminal text alongside an optional kind-tagged model, drained error detail, and an optional intent-resolution trace. See docs/calypso.adoc for the governing design.

## 3.4.0

### Minor Changes

- The typed payload extractors (`listData_get`, `itemData_get`, `items_get`) and common chrisapi types (`PluginInstance`, `Feed`, `FileBrowserFolder`, ...) are re-exported from the package index. The `chrisConnection` singleton is now initialized in place instead of reassigned, fixing stale named-import bindings in ESM consumers.

## 3.3.0

### Minor Changes

- Route all chrisapi access through a single adapter seam (`src/chrisapi/adapter.ts`). The public API is unchanged; responses whose `data` payload is missing now surface as errors instead of propagating `undefined`. Enforced repo-wide by a new `lint:seam` CI check.
