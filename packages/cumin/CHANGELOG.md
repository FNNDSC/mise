# @fnndsc/cumin

## 3.17.1

### Patch Changes

- e3948f1: fix(release): publish `@fnndsc/menu`, without which nothing else installs

  `@fnndsc/menu` was marked private, so changesets versioned it and then skipped publishing it. cumin, brasa, chell and calypso all depend on it, so every published version since menu was extracted has been uninstallable from a clean registry:

  ```
  npm install @fnndsc/brasa
  npm error 404  The requested resource '@fnndsc/menu@*' could not be found
  ```

  It worked in development only because the workspace resolves menu locally, and it went unnoticed because nothing ever installed these packages from npm alone.

  menu is an ordinary library — the wire schemas and types three published packages import. Its manifest was already publish-ready and identical in shape to its siblings; only the flag stood in the way. It is dropped.

  The dependency range is pinned to `^0.3.0` at the same time. `"*"` was an artefact of menu being private, since changesets does not rewrite ranges for packages it will not publish, and `"*"` on a published dependency means any future breaking change applies silently.

  `argus` stays private, and correctly so: it is a browser bundle served from calypso's web root, not a library anyone imports.

- Updated dependencies [e3948f1]
  - @fnndsc/menu@0.3.1

## 3.17.0

### Minor Changes

- 3afaa65: fix(cache): the listing cache's lifetimes stop lying, and the boot row says what it holds

  `ttl_get` compared exact paths or a doubly anchored wildcard, so `/home` never covered `/home/<user>/feeds` and `/feeds/*` matched a top-level path this VFS does not have. Two of the four tuned entries did nothing, and everything but `/bin` and `/PUBLIC` silently took the three-minute default. Matching is now longest-prefix on whole segments, so `/bindings` does not inherit `/bin`.

  Lifetimes are now split by whether a signal exists rather than guessed per path. Where `/proc` reports movement — `/home`, `/SHARED`, `/PUBLIC` — the clock is a backstop against a missed notification and runs long. Where nothing reports, it stays short. The plugin and pipeline indexes go to a day, because registration is an administrative act on a scale of months and an hourly re-walk was the most aggressive refresh in the table for the least mutable data in the system.

  The cache holds 500 path listings rather than 100, and says so the first time it fills: an evicted listing also leaves the checkpoint, so a session that quietly crossed the old cap came back thinner than the one that wrote it.

  The boot row `Listings` becomes `Folders` and reports age alongside count. It is the restored folder-listing checkpoint, not the plugin index, which has its own `Plugins` and `Pipelines` rows; and a count with no age says nothing about whether the restore was worth having.

  Also records the change-discovery entry in `docs/CUBE-gaps.adoc`: CUBE offers no way to ask what changed, which is why clients invent clocks at all.

- 5b4b7db: feat(cache): feed movement dirties the folder listings it touched

  `/proc` already learns when a feed arrives, vanishes, or finishes work. The folder-listing cache, in the same process, heard none of it and re-fetched on a clock instead. This is the wire between them.

  Two rules govern it. Your own act deletes and someone else's act dirties: a mutation removes the entry, because showing a file you just deleted is incoherent, while a job's output or a colleague's share is not wrong but merely behind, so the entry is marked and served at once while it refreshes behind. And movement coalesces, because a feed completing a fan-out stage lands many terminal transitions in the same second.

  Nothing subscribes to the process cache's change stream. That stream fires on every instance add and status observation, so indexing one large feed emits tens of thousands of events, none of which mean a file appeared. Movement is pushed from the three places that actually know: a job crossing into a terminal state, a feed arriving on the roster, and a feed vanishing from it. A merely-running job says nothing, having produced nothing to list.

  Feed-to-path mapping needs no new index. `path_extractFeedID` already reads a feed id out of any cached path, so a shared feed under `/SHARED` is reached by the same rule as one under a home folder, with no extra wiring.

  An arrival changes the folder a feed appears _in_ rather than anything inside it, and the roster speaks only in feed ids, so a host declares those folders once through `rosterParents_set`.

  An arrival is routed by how this identity sees the feed, so a public feed landing on a busy CUBE dirties the public root and not the identity's own feeds folder. A departure is not staleness at all: a feed this identity can no longer reach has no contents to serve, and a dirty entry is still served while it refreshes, so its cached listings are removed rather than marked.

- eaf6c67: feat(acl): a feed's access list, in the shell's own verbs

  An exemplar needed to share a feed and mise had no wrapper, so it reached past the stack to CUBE's REST. That is backwards: a missing wrapper is the work. A capability living in one caller's private REST call is invisible to every other surface and untested by the kernel's suite.

  The kernel gains `feed_share` and `feedShares_list`, over the client's own `addUserPermission` and `getUserPermissions` — which existed all along, so no raw REST was ever needed.

  Its shell face is `setfacl` and `getfacl`, not a `share` verb. Granting an identity access to a thing is an access control entry, and that is a verb a terminal already knows; "share X with Y" is a sentence, and reads as a natural-language assist rather than a shell:

  ```
  setfacl -m u:someone:r /home/me/feeds/feed_12
  getfacl /home/me/feeds/feed_12
    # file: home/me/feeds/feed_12
    user::rw-
    user:someone:r--
  ```

  A feed is named by id, by the `feed_N` a listing shows, or by any path holding one, so a path under `/SHARED` resolves by the same rule as one under a home folder. Group and other entries are refused rather than quietly read as users, an entry granting no read is refused because reading is what a CUBE share conveys, and `-x` is refused **by name** — CUBE models the grant but mise has no revocation to offer, and a shell that appears to strip an entry it cannot strip is worse than one that says so.

  The grammar sits in its own dependency-free module, as `cat`'s does: the engine graph cannot be loaded under jest, so a grammar inside the builtin is a grammar nothing tests.

- f8d1b1c: Index movement is annunciated: a feed's first-visit topology load (`feed 812 indexing: 3400/20000 17%`) and roster arrivals (`+feed 812`, feeds created since or newly shared) reach the prompt context's `procWarmup` segment — `feed`, `arrived`, and `sweeping` so a renderer can tell a sweep from a load — and the chell prompt renders both. The process cache keeps the two registers (`feedLoad_progress/clear/get`, `arrivals_note/recent`); the salsa feed walk and roster syncs feed them.

### Patch Changes

- f73e6c2: fix: a refused read says so, and the header stops wasting the space it takes

  **A file you may list is not always a file you may read.** CUBE lists the contents of a shared feed but refuses the bytes, answering 403 for a file whose size the same identity can see. mise reported that as "not found (404) or access denied (403)" — two opposite answers in one sentence — and the client returns null for a refusal as readily as for an absence, so no status reached the message at all. On the failure path only, the real status is now asked for and reported: a refusal names itself and says what it means.

  **argus swallowed it.** The viewer joined the rendered text of a failed read, which is empty, and drew a blank pane — indistinguishable from an empty file. A refused read now opens as `READ REFUSED` with the session's own words, and the row is remembered: it dims, strikes through, and carries a slashed-circle glyph explaining that it is listed but not readable. This is reactive by necessity, since a listing does not say what may be read.

  **The file browser's frame is not part of its scroll.** The caps and filter strip shared the scrolling box with the rows, so the scrollbar ran the full height of the pane, up behind the frame, and the sticky frame had to paint over whatever passed beneath it — which is what covered the first row's trailing cell. The frame now sits above a scrolling field, so the scrollbar begins at the frame's lower border.

  **The header used one column of two.** The version rows live inside a wrapper, so a two-column grid on the face made that wrapper the single grid item: ten rows stacked in the first track while the second sat empty. The grid moved onto the readout itself. Measured against a live daemon, the band falls from 246px to 199px (19% to 15.3% of viewport), both columns are used, no value wraps or elides, and the attribution is inside the fold instead of clipped.

  **Preview cards take the wheel**, on both axes, with scroll chaining contained, and hold 4000 bytes rather than 600 so there is something behind the gesture.

  **MEDICAL** replaces SICKBAY as the scheme's name and is the scheme a browser that has never chosen one starts in. A remembered `sickbay` choice maps forward rather than being lost.

- aa25502: The process cache records the compute resource each plugin instance ran on (from the CUBE list row), and the `feed.dag` model carries it per node (`mixed` for a group whose members ran on different resources), so a surface can hue a graph by where its work ran.
- 85c6813: The session-state context (working directory, feed, plugin, PACS server) is owned by the process once loaded: its files are written for the next process to restore from, never re-read mid-session. Two daemons of one identity shared a working directory through `cwd.txt`, and a `cd` in one moved the other. Identity (user, URL) still reads from storage; a connect reloads everything.
- Updated dependencies [5dc064e]
- Updated dependencies [73aa61a]
- Updated dependencies [4f034b9]
- Updated dependencies [aa25502]
- Updated dependencies [f8d1b1c]
  - @fnndsc/menu@0.3.0

## 3.16.1

### Patch Changes

- 25c4ebc: Faster daemon entry. A restored `/proc` roster now goes into service on a delta (feeds newer than the highest restored id) instead of a full feed-index walk; the full walk runs behind the listening daemon and reports how many feeds moved while it was away, each refreshing on its next visit (`procRoster_bootSync`; `procRoster_sync` now returns the feeds it brought in or found changed). The rendered `/etc/group` projection lives in the listing cache, so it survives a restart with the listings: past its freshness window it serves at once and re-renders behind itself, and a local membership change still forces a synchronous re-render. The listing checkpoint accepts any JSON payload, not only listings.

## 3.16.0

### Minor Changes

- 7a0f06e: The `/proc` checkpoint is now a directory of per-feed shards (`~/.cache/chell/proc/<identity-key>/roster.json` + `feed-<id>.json`) instead of one file. A mutation to one feed rewrites only that feed's shard, throttled to one write per 30 seconds per shard with the last change never dropped, so a growing 80k-node feed no longer drags the whole index back to disk on every change; a torn write can damage at most one feed, and a shard whose feed left the roster is ignored on restore. Execution metrics observed on a revisit are now checkpointed too (they previously never triggered a save). A legacy v2 single-file checkpoint is read once and migrated into shards; the old file is left in place for this release. Cache change events now say what they touched (`roster`, `feed`, `all`, `lifecycle`).
- c716624: Directory listings survive a restart. The listing cache is checkpointed (identity-keyed file under `~/.cache/chell/vfs/`, throttled writes) and restored at boot with each entry's original timestamp, so a restored listing is exactly as stale as it really is. Stale handling itself is fixed: the listing path used to serve any cached entry regardless of its TTL (a listing never refreshed until eviction or `ls -f`). Now a fresh entry serves as is; a stale one is served at once and revalidated behind itself when a host can carry the refresh (the daemon publishes the fresh `fs.listing` on the ambient bus, marked `fresh`), and is refetched in line at a plain console. `ls` models carry `fresh` per listing; `vfs.listing_get` exposes the listing with its freshness.

### Patch Changes

- 920e0ac: Checkpoint integrity: a snapshot whose topology-loaded feeds are missing from its roster is refused (never overwrite a good checkpoint with an amputated one), and an empty public-feeds walk while public feeds are already known is treated as a failed source — the known feeds are kept and a warning raised — instead of authoritative absence that removed every public feed from the roster.
- cece0dc: `/proc` freshness is now visit-driven. A revisit to `/proc/jobs/feed_N` (or a `feed diagram` re-render) is a delta, not a re-crawl: one feed-row fetch, and only when the job counters moved, a `min_end_date` walk of the nodes created or finished since the last visit plus an `active=true` sweep of the nodes still running. Nodes a dynamic pipeline spawns after the first load now appear on the next visit; previously they were invisible until `proc refresh`. Settled feeds are re-checked at most once per ten minutes, so work appended to a finished feed is still seen. A `/proc/jobs` visit (and `proc feeds` / `proc jobs list`) picks up feeds newer than the highest known id, and walks the whole index once the roster is older than ten minutes, so a feed shared later still appears.
- Updated dependencies [97af423]
  - @fnndsc/menu@0.2.0

## 3.15.1

### Patch Changes

- 44ba77a: Checkpoint schema v2: execution metrics reach existing caches.

  Metrics ride the warmup's list rows — but a v1 checkpoint restores the
  topology and settled feeds never re-page, so an existing cache would never
  backfill `startedAt`/`finishedAt`/`outputBytes`. The schema bump retires v1
  checkpoints: one fresh warmup repopulates with metrics, and the v2
  checkpoint carries them from then on.

## 3.15.0

### Minor Changes

- 1c195a7: Execution metrics ride the warmup for free: node differentiation lands.

  Every CUBE plugin-instance list row already carries `start_date`,
  `end_date`, and `size` — the same rows warmup and status refresh page
  through. They are now typed on the contract, captured into the proc cache
  (`ProcInstance.startedAt/finishedAt/outputBytes`, merged defined-only so a
  refresh never erases what warmup saw), persisted by the checkpoint, and
  projected by `feed diagram` onto each node's `metrics` (wall-clock
  `computeSeconds`, `dataBytes`). Zero new CUBE calls at any point.

  The molecule rendering scales by them (a SCALE pill flips between wall
  time and output bytes, re-projecting the remembered model locally), and
  timestamp-true pulse replay becomes possible.

- e58bf58: The wire contract moves out of `calypso` into a package of its own,
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

## 3.14.0

### Minor Changes

- 386b28c: Walker edge hardening from post-merge review. `ListPage` gains `fetchedCount` so a page whose malformed rows were dropped client-side still advances the walk by what the server served, closing a refetch/early-termination gap in `listPageFlexible_wrap`-backed drains; `pluginPipingsPage_get` exposes the piping list with its pagination signals and the manifest and diagram projections use it (the diagram's `limit: 1000` single-shot now drains fully). A shared `collectionPage_wrap` replaces five hand-copied collection-to-ListPage transcriptions. Salsa's pure PACS folder grammar moves to a dependency-free `pacsGrammar` module exposed as the `./pacs-grammar` subpath, so test mocks forward the real functions instead of maintaining copies.

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
