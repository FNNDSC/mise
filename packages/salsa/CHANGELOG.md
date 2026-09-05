# @fnndsc/salsa

## 3.12.1

### Patch Changes

- aa25502: The process cache records the compute resource each plugin instance ran on (from the CUBE list row), and the `feed.dag` model carries it per node (`mixed` for a group whose members ran on different resources), so a surface can hue a graph by where its work ran.
- f8d1b1c: Index movement is annunciated: a feed's first-visit topology load (`feed 812 indexing: 3400/20000 17%`) and roster arrivals (`+feed 812`, feeds created since or newly shared) reach the prompt context's `procWarmup` segment — `feed`, `arrived`, and `sweeping` so a renderer can tell a sweep from a load — and the chell prompt renders both. The process cache keeps the two registers (`feedLoad_progress/clear/get`, `arrivals_note/recent`); the salsa feed walk and roster syncs feed them.
- aaf0159: `/proc` synthesized files (a node's `log`, `params`, `status`) now serve their UTF-8 bytes through the binary read path, so byte readers such as the daemon's `/vfs` route see the same content `cat` does.
- 85c6813: The session-state context (working directory, feed, plugin, PACS server) is owned by the process once loaded: its files are written for the next process to restore from, never re-read mid-session. Two daemons of one identity shared a working directory through `cwd.txt`, and a `cd` in one moved the other. Identity (user, URL) still reads from storage; a connect reloads everything.
- Updated dependencies [f73e6c2]
- Updated dependencies [3afaa65]
- Updated dependencies [5b4b7db]
- Updated dependencies [eaf6c67]
- Updated dependencies [aa25502]
- Updated dependencies [f8d1b1c]
- Updated dependencies [85c6813]
  - @fnndsc/cumin@3.17.0

## 3.12.0

### Minor Changes

- 25c4ebc: Faster daemon entry. A restored `/proc` roster now goes into service on a delta (feeds newer than the highest restored id) instead of a full feed-index walk; the full walk runs behind the listening daemon and reports how many feeds moved while it was away, each refreshing on its next visit (`procRoster_bootSync`; `procRoster_sync` now returns the feeds it brought in or found changed). The rendered `/etc/group` projection lives in the listing cache, so it survives a restart with the listings: past its freshness window it serves at once and re-renders behind itself, and a local membership change still forces a synchronous re-render. The listing checkpoint accepts any JSON payload, not only listings.

### Patch Changes

- Updated dependencies [25c4ebc]
  - @fnndsc/cumin@3.16.1

## 3.11.0

### Minor Changes

- cece0dc: `/proc` freshness is now visit-driven. A revisit to `/proc/jobs/feed_N` (or a `feed diagram` re-render) is a delta, not a re-crawl: one feed-row fetch, and only when the job counters moved, a `min_end_date` walk of the nodes created or finished since the last visit plus an `active=true` sweep of the nodes still running. Nodes a dynamic pipeline spawns after the first load now appear on the next visit; previously they were invisible until `proc refresh`. Settled feeds are re-checked at most once per ten minutes, so work appended to a finished feed is still seen. A `/proc/jobs` visit (and `proc feeds` / `proc jobs list`) picks up feeds newer than the highest known id, and walks the whole index once the roster is older than ten minutes, so a feed shared later still appears.

### Patch Changes

- 920e0ac: Checkpoint integrity: a snapshot whose topology-loaded feeds are missing from its roster is refused (never overwrite a good checkpoint with an amputated one), and an empty public-feeds walk while public feeds are already known is treated as a failed source — the known feeds are kept and a warning raised — instead of authoritative absence that removed every public feed from the roster.
- 97af423: Watches: a surface can keep a running feed live. New wire pair `watch` / `unwatch` (subject = `/proc/jobs/feed_N`, owned per surface, released on detach) and a `watched` report (`live` | `settled` | `stale`). While anyone watches a feed the engine samples it on an adaptive cadence (3 s while it changes, backing off to 30 s when quiet), and whenever a visit changes the cache it publishes the refreshed `feed.dag` model to every surface as a session-bus envelope from the `daemon` surface, off the scrollback. A feed that settles reports `settled` and the watch ends; a failed sample reports `stale` and keeps trying. `proc watch <feed>` / `proc unwatch <feed>` are the console forms (`proc watch` lists). The engine gains an ambient event bus for events it originates on its own. Feed visits within one second of each other now share one sync, and `feedVisit_sync` reports whether it succeeded.
- Updated dependencies [920e0ac]
- Updated dependencies [7a0f06e]
- Updated dependencies [c716624]
- Updated dependencies [cece0dc]
  - @fnndsc/cumin@3.16.0

## 3.10.1

### Patch Changes

- 1bc0953: `ls` on a ChRIS link (`~/public`, `~/shared`) follows the link instead of rendering the link entry itself: the parent-cache leaf shortcut no longer captures links, so resolution falls through to the dispatcher's PathMapper. Native listings are also name-deduplicated (CUBE's links search can return the same row twice, observed on /PUBLIC).
- Updated dependencies [44ba77a]
  - @fnndsc/cumin@3.15.1

## 3.10.0

### Minor Changes

- 1d600ac: An archive that cannot run no longer leaves a feed behind, and says the right
  reason for not running.

  Live testing found both. `download <dir>` from a browser reported that the
  `zip v20240311` pipeline was not registered, directly below a line explaining
  that one of its nodes was not registered on the target compute environment. The
  pipeline was present; the advice to fetch it from the store was wrong. Every
  `pipeline_run` failure had been collapsed into the one message.

  `pipeline_readiness` in salsa answers whether a pipeline exists and could be
  prepared, distinguishing _unregistered_ from _registered but unpreparable_ —
  different problems calling for different actions.

  Preparing a pipeline needs no previous instance, so readiness is now checked
  _before_ the feed is created. The failed run above had already created a feed
  that nothing then used, leaving litter in a feed list and a copy in the compute
  graph asserting an analysis that produced nothing.

  A run that fails after its feed exists now removes it, and names the feed when
  removal fails. A run that merely exceeds its time limit is left alone, since it
  may yet finish and deleting would remove the feed from under a running job.

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

- 2bb9c29: Registered pipelines gain a durable package store: a warm-up tail sweeps the registry after the topology index settles, fetching only never-seen pipelines and checkpointing identity plus registered manifest to a local CUBE-keyed file. The `/usr/share/packages/<pipeline>` tree serves each pipeline's fields and canonical `manifest.yaml` from that store, and `pipeline diagram` answers from it with no wire traffic at all. The same settlement tail also resolves every unresolved topological-join edge in the background, so a feed's first diagram — however large — renders from cache.
- 3125517: A dropped retrieve watch is no longer reported as a failed pull.

  Pulling a 22-series study reported `0/22 series complete` with every series
  marked `ERROR` — and the CUBE path report printed immediately below it listed
  four of those same series with real paths and file counts. The retrieves were
  fine; the watch had died.

  One websocket failure marked every in-flight series `error`, because
  `RetrieveStatus` had no value meaning _the client stopped watching and does not
  know the outcome_. The code knew the difference — a comment in `pull` says a
  watch failure "is usually cosmetic, the PACS keeps pushing and CUBE keeps
  registering after detach" — but nothing downstream acted on it.

  A lost watch now marks its series `unconfirmed`. The confirmation loop, which
  already asks CUBE about series whose confirmation went missing, now asks about
  these too: a series CUBE reports as stored is `pulled`, with its file count and
  path, whatever the watch managed to see.

  What remains unconfirmed is reported as unknown rather than lost — `? … [WATCH
ENDED — may still be arriving]` — and does not fail the command, because
  nothing in the client knows that it failed. A series that was never fired is
  still a real failure and still fails the command.

- 2c38d8b: Three relations CUBE owns that the namespace could not reach are now projected.

  **`/proc/workflows`** — instantiated pipelines, beside the jobs they own. A
  workflow names the pipeline it ran and owns the plugin instances the run
  created, which is runtime state, so it sits with `/proc/jobs` rather than with
  the pipeline definitions in `/bin`. It projects as a directory of links: the
  `pipeline` entry into `/bin`, each entry under `jobs/` into `/proc/jobs`.
  Nothing restates a job's own representation. Links are lazy — a listing names a
  link without paying to resolve it.

  **`/tags`** — the tags themselves. A tag is a first-class user-owned resource
  pointing at many feeds, so projecting it inside a feed would flatten a
  many-to-many and make editing ambiguous about which copy changed. One object,
  one path.

  **`/usr/share/<plugin>`** — a plugin's version-independent identity: authors,
  licence, type, repository. `/bin` stays flat; nesting versions under a plugin
  directory would make an executable a directory, which is the application-bundle
  trick and costs a permanently divided view. The Unix answer was already here —
  `/bin` holds executables and `/usr/bin` holds their help text — so metadata
  extends that parallel tree. A name given with a `/bin` version suffix resolves
  to the version-independent record.

- b39b584: A dropped retrieve watch reconnects instead of giving up.

  The LONK socket is only how a client watches a retrieve; the retrieve itself
  runs on the server and is unaffected by the socket dying. Losing the view was
  nonetheless the end of the watch — which is why a 22-series study failed where
  a 2-series one did not: a longer retrieve gives the socket more chances to
  drop.

  A dropped socket is now reopened, up to three times, and re-subscribed to the
  series still in flight. Nothing is re-fired: those retrieves were never lost.
  The reconnection is announced, because a silent one during a long pull is
  indistinguishable from a stall.

  Only when reconnection is exhausted does the watch stop, and it still records
  the remaining series as `unconfirmed` rather than failed.

### Patch Changes

- a78b5ee: Everything under a job's `data` link now belongs to the link's target.

  `ls /proc/jobs/feed_N/<plugin>_<id>/data` silently re-listed the instance
  directory (status, params, log, data) instead of the job's output space, so
  a browser rooted at the link showed the wrong entries and built nonsense
  paths like `.../data/log` from them. The proc provider now recognizes the
  `data` segment anywhere after an instance and delegates the whole subtree —
  listing, text reads, and binary reads (new `readBinary`, so images in an
  output space render) — to the resolved CFS target path.

- 56ade16: Pipeline diagrams are cached per client keyed by pipeline id (registered pipelines are immutable, so the first build is the only CUBE traffic a diagram ever costs a session), and a fully settled feed's diagram now renders from the process cache with no status refresh at all — the refresh runs only while some instance can still change.
- Updated dependencies [1c195a7]
- Updated dependencies [e58bf58]
  - @fnndsc/cumin@3.15.0

## 3.9.0

### Minor Changes

- 386b28c: Walker edge hardening from post-merge review. `ListPage` gains `fetchedCount` so a page whose malformed rows were dropped client-side still advances the walk by what the server served, closing a refetch/early-termination gap in `listPageFlexible_wrap`-backed drains; `pluginPipingsPage_get` exposes the piping list with its pagination signals and the manifest and diagram projections use it (the diagram's `limit: 1000` single-shot now drains fully). A shared `collectionPage_wrap` replaces five hand-copied collection-to-ListPage transcriptions. Salsa's pure PACS folder grammar moves to a dependency-free `pacsGrammar` module exposed as the `./pacs-grammar` subpath, so test mocks forward the real functions instead of maintaining copies.

### Patch Changes

- Updated dependencies [386b28c]
  - @fnndsc/cumin@3.14.0

## 3.8.1

### Patch Changes

- b20fa64: Pagination completion: `listPages_drain` joins `listPages_walk` for callers that need a whole collection, and `ListPage` gains an optional `hasMore` hint so a walk survives servers that cap the requested limit. Cumin's own remaining loops (groups, group members, current-user memberships) now ride the shared walker, the peer-store link follower gains a cycle guard and a reported page cap, and the single-shot `limit: 1000` reads in feed resolution, feed comments, workflow creation, and pipeline manifests now drain every page instead of silently truncating at a guess.
- Updated dependencies [b20fa64]
  - @fnndsc/cumin@3.13.0

## 3.8.0

### Minor Changes

- b0b478b: PACS payload and path-grammar consolidation. Cumin gains `dicomPayload`, the one home for DICOM query-payload interpretation (tag unwrapping including the DICOM-JSON `{Value: [...]}` form, study and series array location, UID lookups), replacing four diverged private copies. Salsa's `pacsHelpers` becomes the single authority for the PACS folder grammar, adding `folderUID_get`, `queryLabel_extractFromFolder`, and `queryFolderName_build`; the query path a surface builds now always matches the name the listing shows, including the title fallback the old builder lacked. Brasa's `pacsUtils` and `query` builtins consume the shared helpers; `pacs_tagValueExtract` remains as a compatibility alias.

### Patch Changes

- bb4e06a: One pagination loop for the wire contract: `listPages_walk` joins `ListPage` in cumin's chrisapi contract, owning offset advancement, total latching, and termination for every paginated CUBE read. The six hand-rolled loops in salsa (five in the /proc VFS provider, one in job search) now consume it, so page-walk edge cases have a single tested home.
- Updated dependencies [b0b478b]
- Updated dependencies [bb4e06a]
  - @fnndsc/cumin@3.12.0

## 3.7.0

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

- Updated dependencies [14f8ee8]
- Updated dependencies [69b0617]
  - @fnndsc/cumin@3.11.0

## 3.6.1

### Patch Changes

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
- Updated dependencies [5285bd5]
- Updated dependencies [919648f]
  - @fnndsc/cumin@3.10.0

## 3.6.0

### Minor Changes

- 590a943: Converge the two PACS retrieve watchers onto one engine. pull's battle-tested LONK machinery (bounded, retried firing; stall/timeout/no-activity detection; storage confirmation; refire loop) moves into salsa as the presentation-free `retrieve/watch` module; the `pull` builtin becomes a thin consumer rendering engine events onto its sink, and the PACS VFS provider's `cp` drops its 5-second polling watcher for the same engine, gaining firing retry, LONK push, and the idempotency skip. The convergence surfaced and fixed two latent defects that had made PACS `cp` unusable on real paths: the source parser assumed paths without the `/queries/` segment and rejected every real listing path, and the file downloader only consulted the userfiles collection, so PACS files under `/SERVICES` read as "not found"; it now falls back to the PACS files collection. Supporting dedup: cumin gains `retry_untilValue` (the one bounded-backoff loop) and `seriesStorage_resolve` gains bounded re-probing, replacing the per-package storage-resolver copies; the `_qid:` parser is now shared from salsa.

### Patch Changes

- 2e60785: Cache the `/etc/group` projection per CUBE connection for five minutes,
  invalidate it after ChELL membership changes, and show semantic inspection
  progress while an uncached projection is resolving.
- 66bc932: Add ChELL group membership commands and include current CUBE usernames in the
  live `/etc/group` projection.
- d0ac04f: Preserve failure causes and tighten cache contracts. Errors that were replaced by generic messages now carry their real cause: controller and handler creation failures name the underlying error instead of "no ChRIS context", `cat` shows the actual fetch failure, docker command failures surface stderr detail, context-set errors actually print, settings load/save failures are announced instead of silently using defaults or losing changes, unreadable berth and discovery files are named instead of reading as "no daemon", token-file read errors are distinguished from the logged-out state, and resource deletes report why they failed. Every remaining deliberate error absorption now carries a dated adjudication comment. Cache contracts: the PACS provider's decoded-query cache caches settled results only and is size-bounded; the object-context factory gains an eviction hook (`objContext_evict`) for deleted plugin or feed ids; `mv` and `cp` invalidate the whole affected listing subtree; and a new PACS query invalidates the cached `/net/pacs/queries` listing so it appears in the next `ls` immediately.
- 886f09c: Fix stale directory state in long-lived daemons. Folder object contexts are no longer cached in the cumin context factory: folder paths are not stable identities in CUBE (deleting and re-uploading a directory assigns a new folder id), so a group bound at first touch kept serving the dead folder for the life of the process, which in a calypso daemon meant a freshly uploaded directory listed as permanently empty and `ls -f` could not recover it. Plugin and feed contexts keep their stable-id cache. The listing cache gains `cache_invalidateTree`, and `rm` and directory uploads now invalidate the whole affected subtree, so a delete-and-re-upload cycle cannot serve still-fresh nested listings from the old tree. The salsa native provider also distinguishes a missing folder from an empty one: when every sub-listing comes back empty it probes the parent, and a nonexistent path reports "No such file or directory" instead of rendering as an empty directory.
- 50e9bb1: Make CUBE group membership commands name-first and batch-capable. `group members`, `group inspect`, `group adduser`, and `group removeuser` now accept an exact group name or a numeric ID; add and remove accept multiple usernames, report every result, and make already-satisfied membership changes successful no-ops.
- d0ac04f: BEHAVIOR CHANGE: failures no longer read as empty results. Commands that previously printed nothing and exited 0 when a fetch failed now report the error and exit non-zero, following the codebase's `Result<T>` pattern throughout. Affected surfaces: listing a PACS study or series that does not exist errors instead of showing an empty directory; `store list`/`store search` and `compute list` error when the store or CUBE is unreachable instead of showing no entries; plugin registration no longer defaults to the `host` compute resource when the compute fetch failed; `rm` on a feed fails when running jobs could not be cancelled instead of claiming success; a recursive scan that cannot list a subtree reports the exclusion instead of silently omitting it; batch job-status gaps and disconnected status fetches push visible warnings; the native VFS distinguishes "folder absent" from "could not verify" so probe failures no longer masquerade as missing directories; `cp` fails when path resolution fails rather than proceeding with a guessed path; join-edge resolution retries after a transient failure instead of permanently recording no joins; and the remote client reports invalid daemon messages instead of silently dropping them. Exit codes are now truthful end to end: `ls` reports an error status when any listing fails instead of aggregating failures into success, and `chell -c` derives its exit code from the command's envelopes, so a failed one-shot command exits non-zero even when the builtin did not set an exit code itself.
- 0e92d4d: Persist and reconcile daemon `/proc` checkpoints, fix wildcard listing of
  virtual executables, keep remote admin prompts on their originating surface,
  add a Unix-style `id` builtin for the current CUBE UID/GID projection and group
  memberships, and make versioned-plugin help, parameters, and README output
  compose correctly through terminals, pipes, and redirects.
- fa81126: Retain failed `/proc` topology sweep state and add `proc retry` to continue at
  the failed page without repeating already successful pagination work.
- Updated dependencies [66bc932]
- Updated dependencies [8ec8a4b]
- Updated dependencies [d0ac04f]
- Updated dependencies [886f09c]
- Updated dependencies [d0ac04f]
- Updated dependencies [22db63f]
- Updated dependencies [0e92d4d]
- Updated dependencies [590a943]
  - @fnndsc/cumin@3.9.0

## 3.5.5

### Patch Changes

- Carry backing resource IDs on VFS entries so cache-only virtual executable
  summaries can retain stable Pipeline identity.

## 3.5.4

### Patch Changes

- Add a lightweight registered-manifest projection, exact targeted Pipeline
  slug resolution, and connection-scoped manifest and hosted-plugin metadata
  caches.

## 3.5.3

### Patch Changes

- Project registered pipelines as typed invocation manifests, validate and merge
  sparse parameter/resource overlays, and create Workflows from complete node sets.
- Preserve plugin parameter values as typed data through Cumin execution.
- Updated dependencies
  - @fnndsc/cumin@3.8.4

## 3.5.2

### Patch Changes

- Export a typed feed-creation result so PACS, plugin, and future pipeline
  workflows can share the same feed/root identity contract.
- Updated dependencies
  - @fnndsc/cumin@3.8.3

## 3.5.1

### Patch Changes

- 6f0833a: Release the coordinated ChELL stack with deterministic `/proc` topology progress, complete visible-feed indexing, safe warm-up query gating, remote one-shot command completion, and refreshed daemon documentation.
- Updated dependencies [6f0833a]
  - @fnndsc/cumin@3.8.1

## 3.5.0

### Minor Changes

- e630f79: Draw registered CUBE pipelines with `pipeline diagram <id|name>` or the `/bin` shorthand `<pipeline> --diagram`. Bare output uses the same shallow tree machinery as feed diagrams, `--withargs` appends stored non-null plugin defaults, and `--signalflow` emits the same SignalFlow YAML dialect as feeds. `feed diagram <specifier>` is now a shallow alias of `feed tree`; feed graph commands accept IDs, `feed_N`, exact or unambiguous title searches, and infer the feed from the current `feed_N` directory when omitted.

### Patch Changes

- Updated dependencies [e630f79]
  - @fnndsc/cumin@3.8.0

## 3.4.0

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

- 01ab743: `feed tree` now builds the DAG **cache-first** from the warm ProcCache instead of
  re-crawling the feed on every call. It reuses already-loaded topology, fetches feed
  metadata only when missing or a placeholder, refreshes volatile status cheaply (one
  feed-scoped list call, active nodes only) when reusing a warm cache, and resolves join
  edges lazily. New salsa exports: `feedGraphData_ensure`, `feedMeta_ensure`,
  `feedInstances_ensureLoaded`, `feedStatus_refresh`.

### Patch Changes

- Updated dependencies [a1f6694]
  - @fnndsc/cumin@3.7.0

## 3.3.0

### Minor Changes

- 0d358c5: /proc now caches settled job status. A finished plugin instance
  (`finishedSuccessfully`, `finishedWithError`, `cancelled`) never changes, so its
  status is kept permanently once observed. Consequences:

  - Listing a fully-finished feed under `/proc/jobs` is instant — no status calls.
  - Live status for active feeds is refreshed with a single feed-scoped list call
    (the list response already carries `status`) instead of one detail fetch per node.
  - Reading a settled instance's `status` returns the cached value without an API call.

### Patch Changes

- Updated dependencies [0d358c5]
  - @fnndsc/cumin@3.6.0

## 3.2.6

### Patch Changes

- The PACS VFS content reader parses query folder ids with the same helper as the listing provider; `cat metadata.json` inside `/net/pacs/queries/...` directories works again (it failed with "Invalid query ID in path" on the modern `<desc>_qid:<id>` folder naming).

## 3.2.5

### Patch Changes

- Test coverage lock-in: global coverage ratchets raised and a 60% per-file floor enforced in CI. No runtime changes.
- Updated dependencies
  - @fnndsc/cumin@3.3.0
