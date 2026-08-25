# @fnndsc/cumin

## 3.13.0

### Minor Changes

- b20fa64: Pagination completion: `listPages_drain` joins `listPages_walk` for callers that need a whole collection, and `ListPage` gains an optional `hasMore` hint so a walk survives servers that cap the requested limit. Cumin's own remaining loops (groups, group members, current-user memberships) now ride the shared walker, the peer-store link follower gains a cycle guard and a reported page cap, and the single-shot `limit: 1000` reads in feed resolution, feed comments, workflow creation, and pipeline manifests now drain every page instead of silently truncating at a guess.

## 3.12.0

### Minor Changes

- b0b478b: PACS payload and path-grammar consolidation. Cumin gains `dicomPayload`, the one home for DICOM query-payload interpretation (tag unwrapping including the DICOM-JSON `{Value: [...]}` form, study and series array location, UID lookups), replacing four diverged private copies. Salsa's `pacsHelpers` becomes the single authority for the PACS folder grammar, adding `folderUID_get`, `queryLabel_extractFromFolder`, and `queryFolderName_build`; the query path a surface builds now always matches the name the listing shows, including the title fallback the old builder lacked. Brasa's `pacsUtils` and `query` builtins consume the shared helpers; `pacs_tagValueExtract` remains as a compatibility alias.
- bb4e06a: One pagination loop for the wire contract: `listPages_walk` joins `ListPage` in cumin's chrisapi contract, owning offset advancement, total latching, and termination for every paginated CUBE read. The six hand-rolled loops in salsa (five in the /proc VFS provider, one in job search) now consume it, so page-walk edge cases have a single tested home.

## 3.11.0

### Minor Changes

- 14f8ee8: Deletion works from any context. `rm` no longer depends on the session's
  current directory or a prior listing: `files_delete` anchors at the target's
  parent folder and loads its collection itself, and chili's `rm` passes that
  parent explicitly. New path-addressed deletion API: cumin
  `folder_deleteByPath` and salsa `folderByPath_delete`, which return only
  once the CUBE confirms the folder no longer resolves. Context writes are
  ordered after session-filename resolution, fixing a fresh session's first
  `cd` intermittently losing its value.

### Patch Changes

- 69b0617: Typed chell API, third tranche: `cp` and `mv` join the facade with their
  existing `fs.cp`/`fs.mv` models. Fixing what their first typed run
  surfaced: file rename was silently broken against current CUBEs (the PUT
  field drifted from `path` to `upload_path`); cumin now sends the current
  field and falls back for older servers.

## 3.10.0

### Minor Changes

- 5285bd5: Cast burndown to the adapter floor. The wire contract gains the pipelines
  surface (`pipeline_get` with piping items and plugin metadata handles,
  `pipelineSourceFilesPage_get`); salsa's pipeline modules, feed joins, and
  brasa/chili call sites migrate onto typed accessors and honest converters.
  The repository's `as unknown as` count is now 2, both inside the licensed
  adapter seam, and the CI ratchet holds it there. chell progress bars also
  draw on the renderer's configured stream instead of assuming stdout.
- 919648f: Typed chrisapi wire contract over the jobs and PACS surfaces. cumin gains
  `feedsPage_get`, `publicFeedsPage_get`, `pluginInstancesPage_get`,
  `pluginInstance_get` (typed detail handle with parameters, status, logs,
  delete), and `downloadToken_create`, with the wire row shapes (`FeedData`,
  `PluginInstanceData`, `InstanceParameterData`, `DownloadToken`) declared once.
  salsa's proc provider, job operations, and retrieve watcher now call the
  contract instead of casting the opaque client per call site.

## 3.9.0

### Minor Changes

- 22db63f: Make PACS pulls observable and recoverable. A new `pacs status <expression | path | queryId>` reports one line per series: a fill bar of files registered in CUBE against the PACS-reported instance count, the derived state, and the in-CUBE `/SERVICES` folder for every landed series; an expression reuses the caller's most recent matching query instead of minting a new record per check. `pull` is now idempotent: series already fully registered in CUBE are skipped before firing, so re-running the same pull fetches exactly the missing series. Retrieve firing gets three attempts with backoff and is bounded to four concurrent creations, replacing the all-at-once stampede that overloaded CUBE and silently lost retrieves. A series whose firing still fails is reported as `FAILED TO FIRE, will not arrive; re-run pull`, distinct from watch-side failures, which now point at `pacs status` since their transfers usually complete server-side anyway. Cumin's status report gains the per-series storage folder (`seriesStorage_resolve`). The failure modes and operator playbook are documented in docs/pacs-pull-recovery.adoc.
- 590a943: Converge the two PACS retrieve watchers onto one engine. pull's battle-tested LONK machinery (bounded, retried firing; stall/timeout/no-activity detection; storage confirmation; refire loop) moves into salsa as the presentation-free `retrieve/watch` module; the `pull` builtin becomes a thin consumer rendering engine events onto its sink, and the PACS VFS provider's `cp` drops its 5-second polling watcher for the same engine, gaining firing retry, LONK push, and the idempotency skip. The convergence surfaced and fixed two latent defects that had made PACS `cp` unusable on real paths: the source parser assumed paths without the `/queries/` segment and rejected every real listing path, and the file downloader only consulted the userfiles collection, so PACS files under `/SERVICES` read as "not found"; it now falls back to the PACS files collection. Supporting dedup: cumin gains `retry_untilValue` (the one bounded-backoff loop) and `seriesStorage_resolve` gains bounded re-probing, replacing the per-package storage-resolver copies; the `_qid:` parser is now shared from salsa.

### Patch Changes

- 66bc932: Add ChELL group membership commands and include current CUBE usernames in the
  live `/etc/group` projection.
- 8ec8a4b: Add explicit, command-scoped CUBE elevation with `sudo <command>`. The active surface collects an administrator identity and hidden password; a temporary CUBE client runs only the nested command, then the normal session is restored. Group membership and plugin registration now suggest a copyable `sudo` rerun after an authorization failure, and plugin registration no longer owns a separate interactive admin prompt.
- d0ac04f: Preserve failure causes and tighten cache contracts. Errors that were replaced by generic messages now carry their real cause: controller and handler creation failures name the underlying error instead of "no ChRIS context", `cat` shows the actual fetch failure, docker command failures surface stderr detail, context-set errors actually print, settings load/save failures are announced instead of silently using defaults or losing changes, unreadable berth and discovery files are named instead of reading as "no daemon", token-file read errors are distinguished from the logged-out state, and resource deletes report why they failed. Every remaining deliberate error absorption now carries a dated adjudication comment. Cache contracts: the PACS provider's decoded-query cache caches settled results only and is size-bounded; the object-context factory gains an eviction hook (`objContext_evict`) for deleted plugin or feed ids; `mv` and `cp` invalidate the whole affected listing subtree; and a new PACS query invalidates the cached `/net/pacs/queries` listing so it appears in the next `ls` immediately.
- 886f09c: Fix stale directory state in long-lived daemons. Folder object contexts are no longer cached in the cumin context factory: folder paths are not stable identities in CUBE (deleting and re-uploading a directory assigns a new folder id), so a group bound at first touch kept serving the dead folder for the life of the process, which in a calypso daemon meant a freshly uploaded directory listed as permanently empty and `ls -f` could not recover it. Plugin and feed contexts keep their stable-id cache. The listing cache gains `cache_invalidateTree`, and `rm` and directory uploads now invalidate the whole affected subtree, so a delete-and-re-upload cycle cannot serve still-fresh nested listings from the old tree. The salsa native provider also distinguishes a missing folder from an empty one: when every sub-listing comes back empty it probes the parent, and a nonexistent path reports "No such file or directory" instead of rendering as an empty directory.
- d0ac04f: BEHAVIOR CHANGE: failures no longer read as empty results. Commands that previously printed nothing and exited 0 when a fetch failed now report the error and exit non-zero, following the codebase's `Result<T>` pattern throughout. Affected surfaces: listing a PACS study or series that does not exist errors instead of showing an empty directory; `store list`/`store search` and `compute list` error when the store or CUBE is unreachable instead of showing no entries; plugin registration no longer defaults to the `host` compute resource when the compute fetch failed; `rm` on a feed fails when running jobs could not be cancelled instead of claiming success; a recursive scan that cannot list a subtree reports the exclusion instead of silently omitting it; batch job-status gaps and disconnected status fetches push visible warnings; the native VFS distinguishes "folder absent" from "could not verify" so probe failures no longer masquerade as missing directories; `cp` fails when path resolution fails rather than proceeding with a guessed path; join-edge resolution retries after a transient failure instead of permanently recording no joins; and the remote client reports invalid daemon messages instead of silently dropping them. Exit codes are now truthful end to end: `ls` reports an error status when any listing fails instead of aggregating failures into success, and `chell -c` derives its exit code from the command's envelopes, so a failed one-shot command exits non-zero even when the builtin did not set an exit code itself.
- 0e92d4d: Persist and reconcile daemon `/proc` checkpoints, fix wildcard listing of
  virtual executables, keep remote admin prompts on their originating surface,
  add a Unix-style `id` builtin for the current CUBE UID/GID projection and group
  memberships, and make versioned-plugin help, parameters, and README output
  compose correctly through terminals, pipes, and redirects.

## 3.8.4

### Patch Changes

- Carry per-node CPU, memory, GPU, and worker controls through the typed CUBE
  Workflow `nodes_info` contract.
- Accept typed plugin-run parameters without a lossy CLI string round trip.

## 3.8.3

### Patch Changes

- Preserve structured feed-creation parameters, including titles containing
  commas, while retaining support for legacy comma-delimited parameters.

## 3.8.2

### Patch Changes

- Carry cold, cached-refresh, and failed `/proc` lifecycle state through the
  CALYPSO prompt contract; reorder p10k segments and render distinct lifecycle
  clues for local and remote surfaces.

## 3.8.1

### Patch Changes

- 6f0833a: Release the coordinated ChELL stack with deterministic `/proc` topology progress, complete visible-feed indexing, safe warm-up query gating, remote one-shot command completion, and refreshed daemon documentation.

## 3.8.0

### Minor Changes

- e630f79: Draw registered CUBE pipelines with `pipeline diagram <id|name>` or the `/bin` shorthand `<pipeline> --diagram`. Bare output uses the same shallow tree machinery as feed diagrams, `--withargs` appends stored non-null plugin defaults, and `--signalflow` emits the same SignalFlow YAML dialect as feeds. `feed diagram <specifier>` is now a shallow alias of `feed tree`; feed graph commands accept IDs, `feed_N`, exact or unambiguous title searches, and infer the feed from the current `feed_N` directory when omitted.

## 3.7.0

### Minor Changes

- a1f6694: Feed-DAG data layer. Projects a feed's cached plugin-instance topology into a flat,
  surface-agnostic `FeedGraph` and resolves topological-join (`ts`) edges.

  - **cumin:** `ProcInstance` gains `pluginType` (authoritative `ts` detection) and
    `joinParentIDs` (cached join overlay); `ProcCache.joinParents_update`/`joinParents_get`
    and `feedInstanceIDs_get` (anchor-tree traversal).
  - **salsa:** `feedGraph_build` + `signature_compute` (a per-node topology signature — a
    hash of plugin name plus the sorted child signatures, status excluded — so surfaces can
    group isomorphic siblings without re-deriving the grouping); `feedJoins_ensure` /
    `nodeJoins_resolve` fetch a join node's `plugininstances` parameter and record its extra
    parents (sources minus the anchor).

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
