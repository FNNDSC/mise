# @fnndsc/menu

## 0.8.0

### Minor Changes

- 7c793ad: `pacs.query` series carry `folderPath`, the CUBE folder a pulled series landed in, so a surface can open the series as an image from the row that holds it.
- af2df66: New `dicom.series` and `dicom.tags` model kinds: a folder as a series, and a file's tags or a folder's constant-versus-varying split, with identifying tags flagged so a surface can redact by the flag.

## 0.7.0

### Minor Changes

- d89e31b: A feed-list row now carries `jobsErrored` (the errored-or-cancelled count, from the proc cache's per-status counters), so a surface can fill an errored feed's progress bar to the work that actually succeeded — `jobsDone - jobsErrored` over `jobsTotal` — rather than run it full in the error hue. The RUNS roster uses it; a full red bar said nothing a red mark would not.

## 0.6.0

### Minor Changes

- 49634f2: feat(menu): the telemetry heartbeat carries the lane (the running line, since when, how many wait) and CUBE's pace
- 2545ffa: feat(menu): the telemetry heartbeat carries the lab's pulse (`state`)

## 0.5.0

### Minor Changes

- 6cd5ab1: feat(menu): the `feed.indexing` envelope model — a feed asked for while its topology is still being indexed — and a `failed` field on the prompt context's feed-load progress
- 57ba039: feat(menu): the prompt context carries every feed topology walk in flight (`procWarmup.feeds`); `feed` stays the first for older readers
- 98ab832: feat(menu): the prompt context names the roster walk in flight (`procWarmup.roster`: delta or full)

## 0.4.0

### Minor Changes

- 116e8ba: feat(listing): progress is a trait of a row, and a row can carry verbs

  The operator's observation: progress is not a PACS quirk. A feed row should say how far its work has got without anyone opening it, and every level should report — a series its own pull, a study the sum of its series, a patient the sum of its studies.

  **The wire could not say it.** The `feed.list` model carried id, title, owner, status, created and two totals that need resident topology, so a roster genuinely could not know a feed's progress. CUBE's own job counters were already on the process cache, so the kernel now derives `jobsDone` and `jobsTotal` from them — settled meaning finished, errored or cancelled — and they travel with the feed row rather than waiting for topology. Kernel, wire, surface, in that order.

  **Progress aggregates by addition, not by average.** A study's progress is the sum of its series'. An average would let one finished series of a hundred files outweigh a stalled one of ten thousand.

  **A row with nothing scheduled still gets a track**, dimmed. The absence of a bar reads as "no such thing"; a dim track reads as "nothing has happened yet", which is the truth and the more useful statement.

  **Actions are not traits.** A trait says what a row is under some column; an action is a verb applied to it, and it sits outside the column grid because it answers to no cap. Capsules stop click propagation, so pressing one is not also activating the row.

  **Expansion has two modes**, declared rather than assumed: `replace` leaves the parent behind, `fold` keeps it on stage with the child inside. PACS exercises both in the next slice.

  The runs roster gains NODES and PROGRESS, which widened its positional track list from seven columns to nine.

  One smoke assertion changed, and deliberately: it counted seven cells per row as a literal. It now counts cells against the number of caps, which is the invariant that actually protects a positional grid and needs no edit when a column is added.

- 7181f7e: feat: a PACS question can be put to several servers at once

  `--pacsserver a,b` asks each named server and unions the answers into one listing. It is the same fan-out a cohort uses, discriminated by a different column: SERVER rides every study and every patient row, so two answers can be told apart, sorted and filtered.

  **A row names its server only when more than one could have answered.** On a single-server query the column would repeat one value down the page and tell an operator nothing.

  **There is no sweep-everything.** The CUBE this was designed against carries thirteen registered servers, several reading as one-off or per-person registrations; an `--all` would mean thousands of C-FINDs mostly into endpoints of unknown liveness. A fan-out is always something the operator named.

  **A server that could not be reached is `unasked`, not empty.** Verified live: naming a server that does not resolve leaves that row `—` with its reason while the server that did answer still reports what it found. A server that could not be reached has told us nothing about that patient; rendering it as a zero would say the opposite.

  The reason on such a row is stripped of the error stack's debugging prefix where it becomes model data, since it is read in a terminal table and on a graphical surface alike.

  Servers are keyed by their canonical identifier — what CUBE files a query under, and therefore what the replay index matches on, so a question already asked of one server replays while the same question to another is asked fresh.

- d2a4315: feat(menu): a PACS answer can say what it did NOT find

  `pacs.query` described what a query found and nothing else. That makes the answer an operator usually wants — which of these two hundred MRNs have no imaging — the invisible half of the result.

  The model now carries a patient level: every MRN asked, with its status, its study and series counts, the CUBE query that answered for it, and its own provenance.

  **Three states, not two.** `found`, `none` and `unasked`. A query that could not be asked is not a query that found nothing, and rendering a timeout as `0` is precisely the confident stale answer the replay work exists to refuse. An unrecognized status from a newer daemon degrades to `unasked`, the only degrade that never reads as an answer this contract never received.

  The studies keep their shape and stay on the model, each carrying its own `patientId`. The patient level is not a container for them — it is the record of what was _asked_, which is why it cannot be derived: a miss owns no study.

  Provenance is per patient as well as per answer, because a fan-out replays some rows and troubles the PACS for others.

  Optional, as `provenance` is: an envelope from a daemon that predates the fan-out still parses, and a surface reads its absence as the single-question case it could only have been.

- a245b5f: feat: choosing which PACS to ask is a strip you pick from, never a sweep

  SERVER became a column of the study listing, and the law that places a form's fields put its control there with no separate decision to make: the cell stands in SERVER's column, wearing the form's own label.

  It is a **state readout you press** — `PACSDCM`, `PACSDCM +2` — that unfolds a strip of segments beneath the form, one per registered server, lit when included; the field's touch or Esc retracts it, the same retraction grammar the mode frames already use. Not a dropdown: LCARS has no popup layer and should not grow one, since a floating menu is exactly the window chrome this grammar rejects — and a strip of the pane's own width carries thirteen servers where a grid track could not carry three.

  **There is no ALL, and there will not be one.** Thirteen registrations of unknown liveness would mean thousands of C-FINDs mostly into the void. A fan-out is always something the operator named.

  **One chosen is a context; several is a query.** One lowers to a visible `pacs connect`, so the session moves and the linked terminal's prompt follows. Several lowers to `--pacsserver a,b` in the editable line and moves nothing. The prompt changing, or not, is the honest tell.

  **The list comes from the kernel, not from CUBE.** `pacs list` now carries a `pacs.servers` model beside the text it always printed — id, identifier, and which one the session is on. A surface asking CUBE itself would be reading a different CUBE from the one its commands run against. Liveness is deliberately absent: CUBE registers servers, it does not test them, and a field that looked like health would be a claim nobody checked.

  Two things found live: the PACS pane's own commands had no way back to it — the DAG pane's already did — so `pacs list` answered into the void; and the document's retraction listener closed the strip with the very press that opened it.

  Law `a-server-is-named-never-swept`, smoke-enforced.

- 5a339f0: feat: a plugin is data — the manual becomes a projection of the model

  A plugin's substance existed only as text. `cat /bin/<entry>` fetched the plugin, formatted a manual, and that manual was the whole of what any surface could have — a paragraph nothing downstream can act on: not a card, not a parameter list, not a form, not an export.

  The kernel now builds the model first and renders the manual from it. `plugin info pl-dcm2niix-v2.0.0` answers with a `plugin.info` model carrying identity, the authoring facts, and every declared parameter; `cat /bin/pl-dcm2niix-v2.0.0` prints exactly the text it printed before, now as one projection of that model rather than a second independent scrape that can drift from it.

  **Parameters carry the flag as it is typed.** A plugin's own `flag` when it declares one, `--name` otherwise — a form built from the name alone would spell `--inputFile` where the plugin wants `-i`.

  **The parameter list is drained to exhaustion.** `getPluginParameters({ limit: 100 })` was one of the silent truncations catalogued in #401: a plugin declaring more lost the tail and said nothing about it. `pluginParameters_drain` walks to the end, and a live exemplar checks the model's count against the count CUBE itself reports — a client that both fetches and counts can agree with itself while being wrong.

  cumin gains `plugin_find` and `pluginParameters_drain` on the typed contract, so the `/bin` reader no longer reaches past it to the raw client.

  No surface change: this is the wire fact a plugin's one-node graph will read.

- 62761a3: feat(menu): a question says what kind of value it wants

  The wire has always carried a question — `prompt` / `promptAnswer` / `promptError` — and a surface has only ever been able to answer it with a line of text. That is enough for a terminal and not enough for anything else: argus refuses every prompt outright (`the argus surface cannot answer prompts`), so `sudo` dead-ends in the web surface and no control can ask for a value the operator has not already typed.

  A prompt now says what it is asking FOR, so a surface can choose its instrument rather than reading the wording and guessing:

  - **`wants`** — `text`, `secret`, `confirm` or `path`. Open-world: an unrecognized kind degrades to `text`, which every surface can answer, so a question from a newer daemon stays answerable rather than refused.
  - **`path`** — where browsing starts, whether a file or a directory is wanted, and a basename to offer. An errand that opens nowhere in particular is a browser, not an answer.
  - **`commit`** — the word the committing control should read (`EXPORT HERE`). A control reads as what it will do next.

  Everything is optional, so a daemon or a surface that predates this still parses and still answers. `hidden: true` with no kind reads as `secret` — what such a daemon could only have meant — and that reconciliation is `promptKind_of` in `menu` rather than a rule each surface re-derives: two readings of one message is how a terminal and a browser end up masking different things.

  No contract bump: the additions are optional, and `version_isCompatible` refuses on any mismatch, so a bump would turn a backward-compatible change into a hard break.

## 0.3.1

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

## 0.3.0

### Minor Changes

- 5dc064e: feat(boot): warm-up leaves the gate, and a failure that leaves it is still heard

  Boot blocked on four prefetches in front of the prompt. Measured against a live CUBE, `/PUBLIC` costs 8.4 seconds and `/SHARED` 9.3 — roughly eighteen seconds an operator spent watching a prompt that was already theirs, buying freshness the stale-serve path delivers a moment later anyway, since the checkpoint restore has already put those listings in the cache.

  Boot now blocks only on `/bin`, which completion cannot work without: an empty completer reads as a broken prompt rather than a fast one. Groups, Feeds, Public and a newly added `/SHARED` step warm behind the prompt under a new `PENDING` boot status. They keep their bounded retry policy; a transient failure should be retried before it is announced.

  `/SHARED` had no step at all before. That is where another identity's work becomes visible, and with nothing to fail, a CUBE that stopped serving shared paths stayed silent until somebody went looking.

  **A deferred step leaves the boot failure gate**, so its failure can no longer stop a daemon binding — and a boot readout has scrolled away by the time it arrives. The failure is held until a later attempt succeeds and carried on the prompt context, so every surface says it: chell's prompt reads `[warm-up failed: groups]`, and argus names it on the JOBS readout in mars with the reason on hover. Named rather than counted, because "Groups" tells an operator which capability is degraded where "1 warm-up failed" only tells them to go looking.

  Nothing reports a deferred completion. A warm that finishes and changes nothing is not news.

  Carries AEGIS law `deferred-warmup-failure-persists` with its smoke, which drives the surface's real prompt-context path rather than asserting a stub.

- 73aa61a: The feed roster (`proc feeds`, the RUNS pane) reports each resident feed's total output size and wall span, derived from the cache with no wire; `cd` into a CFS link now follows it to its target, and a refusal names that target.
- 4f034b9: Host control: `chell --daemon --host-control[=shell,files,pipes]` lets the daemon declare capabilities of its own — `!` runs on the daemon host, pipe segments run there, `upload`/`download` reach its disk — off by default, refused on a non-loopback bind without `--expose-host-control`, and annunciated everywhere (attach ack `hostControl`, the daemon face, the prompt's HOST segment, a remote shell's banner). Without the `files` tier, `upload` under a daemon now refuses instead of reading the daemon host's disk.
- aa25502: The process cache records the compute resource each plugin instance ran on (from the CUBE list row), and the `feed.dag` model carries it per node (`mixed` for a group whose members ran on different resources), so a surface can hue a graph by where its work ran.
- f8d1b1c: Index movement is annunciated: a feed's first-visit topology load (`feed 812 indexing: 3400/20000 17%`) and roster arrivals (`+feed 812`, feeds created since or newly shared) reach the prompt context's `procWarmup` segment — `feed`, `arrived`, and `sweeping` so a renderer can tell a sweep from a load — and the chell prompt renders both. The process cache keeps the two registers (`feedLoad_progress/clear/get`, `arrivals_note/recent`); the salsa feed walk and roster syncs feed them.

## 0.2.0

### Minor Changes

- 97af423: Watches: a surface can keep a running feed live. New wire pair `watch` / `unwatch` (subject = `/proc/jobs/feed_N`, owned per surface, released on detach) and a `watched` report (`live` | `settled` | `stale`). While anyone watches a feed the engine samples it on an adaptive cadence (3 s while it changes, backing off to 30 s when quiet), and whenever a visit changes the cache it publishes the refreshed `feed.dag` model to every surface as a session-bus envelope from the `daemon` surface, off the scrollback. A feed that settles reports `settled` and the watch ends; a failed sample reports `stale` and keeps trying. `proc watch <feed>` / `proc unwatch <feed>` are the console forms (`proc watch` lists). The engine gains an ambient event bus for events it originates on its own. Feed visits within one second of each other now share one sync, and `feedVisit_sync` reports whether it succeeded.
