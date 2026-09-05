# @fnndsc/chell

## 5.5.1

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
  - @fnndsc/cumin@3.17.1
  - @fnndsc/brasa@0.16.1
  - @fnndsc/calypso@0.9.1

## 5.5.0

### Minor Changes

- 5dc064e: feat(boot): warm-up leaves the gate, and a failure that leaves it is still heard

  Boot blocked on four prefetches in front of the prompt. Measured against a live CUBE, `/PUBLIC` costs 8.4 seconds and `/SHARED` 9.3 — roughly eighteen seconds an operator spent watching a prompt that was already theirs, buying freshness the stale-serve path delivers a moment later anyway, since the checkpoint restore has already put those listings in the cache.

  Boot now blocks only on `/bin`, which completion cannot work without: an empty completer reads as a broken prompt rather than a fast one. Groups, Feeds, Public and a newly added `/SHARED` step warm behind the prompt under a new `PENDING` boot status. They keep their bounded retry policy; a transient failure should be retried before it is announced.

  `/SHARED` had no step at all before. That is where another identity's work becomes visible, and with nothing to fail, a CUBE that stopped serving shared paths stayed silent until somebody went looking.

  **A deferred step leaves the boot failure gate**, so its failure can no longer stop a daemon binding — and a boot readout has scrolled away by the time it arrives. The failure is held until a later attempt succeeds and carried on the prompt context, so every surface says it: chell's prompt reads `[warm-up failed: groups]`, and argus names it on the JOBS readout in mars with the reason on hover. Named rather than counted, because "Groups" tells an operator which capability is degraded where "1 warm-up failed" only tells them to go looking.

  Nothing reports a deferred completion. A warm that finishes and changes nothing is not news.

  Carries AEGIS law `deferred-warmup-failure-persists` with its smoke, which drives the surface's real prompt-context path rather than asserting a stub.

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

- 4f034b9: Host control: `chell --daemon --host-control[=shell,files,pipes]` lets the daemon declare capabilities of its own — `!` runs on the daemon host, pipe segments run there, `upload`/`download` reach its disk — off by default, refused on a non-loopback bind without `--expose-host-control`, and annunciated everywhere (attach ack `hostControl`, the daemon face, the prompt's HOST segment, a remote shell's banner). Without the `files` tier, `upload` under a daemon now refuses instead of reading the daemon host's disk.

### Patch Changes

- 75f1e5f: fix(boot): a step's label stops moving when it finishes

  A boot step is announced while it runs and again when it settles, and the two lines disagreed about where the label starts. The running line hardcoded a five-space indent against a comment asserting `[ OK ] ` was seven characters wide; the finished line pads its tag to the widest tag and adds a space. The label therefore jumped a column as each step resolved, and the plain non-interactive log was out by three rather than one.

  The indent is now derived from the host's own tag width and from whether a spinner glyph precedes the text, since an animated line draws a frame and a space of its own and owes only the remainder while a plain log line owes the whole column. `chell` passes the width it actually renders with, so a longer status added later moves both lines together.

  The arithmetic lives in its own import-free module, because the wider engine graph cannot be loaded under jest and an untestable alignment rule is how the first version came to be wrong.

- fe1dd0e: fix(boot): the boot readout's label column stops moving with the status

  Status tags are not all the same width — `[RETRY]` is a character wider than `[ OK ]` — and only the label was padded, so a retry row's label and message sat one column right of every other row's.

  Tags now come from a table and are padded to the width of the widest, with the padding applied to the bare text before colour, since padding a colour-wrapped string counts the escape sequences instead of the visible characters. The width is derived from the table rather than written down, so a longer status added later widens every row together instead of shunting one label out of line.

- f8d1b1c: Index movement is annunciated: a feed's first-visit topology load (`feed 812 indexing: 3400/20000 17%`) and roster arrivals (`+feed 812`, feeds created since or newly shared) reach the prompt context's `procWarmup` segment — `feed`, `arrived`, and `sweeping` so a renderer can tell a sweep from a load — and the chell prompt renders both. The process cache keeps the two registers (`feedLoad_progress/clear/get`, `arrivals_note/recent`); the salsa feed walk and roster syncs feed them.
- Updated dependencies [f73e6c2]
- Updated dependencies [5dc064e]
- Updated dependencies [75f1e5f]
- Updated dependencies [3afaa65]
- Updated dependencies [5b4b7db]
- Updated dependencies [eaf6c67]
- Updated dependencies [73aa61a]
- Updated dependencies [4f034b9]
- Updated dependencies [aa25502]
- Updated dependencies [f8d1b1c]
- Updated dependencies [aaf0159]
- Updated dependencies [85c6813]
  - @fnndsc/cumin@3.17.0
  - @fnndsc/menu@0.3.0
  - @fnndsc/brasa@0.16.0
  - @fnndsc/calypso@0.9.0
  - @fnndsc/salsa@3.12.1

## 5.4.3

### Patch Changes

- 25c4ebc: Faster daemon entry. A restored `/proc` roster now goes into service on a delta (feeds newer than the highest restored id) instead of a full feed-index walk; the full walk runs behind the listening daemon and reports how many feeds moved while it was away, each refreshing on its next visit (`procRoster_bootSync`; `procRoster_sync` now returns the feeds it brought in or found changed). The rendered `/etc/group` projection lives in the listing cache, so it survives a restart with the listings: past its freshness window it serves at once and re-renders behind itself, and a local membership change still forces a synchronous re-render. The listing checkpoint accepts any JSON payload, not only listings.
- Updated dependencies [25c4ebc]
  - @fnndsc/salsa@3.12.0
  - @fnndsc/cumin@3.16.1

## 5.4.2

### Patch Changes

- 7a0f06e: The `/proc` checkpoint is now a directory of per-feed shards (`~/.cache/chell/proc/<identity-key>/roster.json` + `feed-<id>.json`) instead of one file. A mutation to one feed rewrites only that feed's shard, throttled to one write per 30 seconds per shard with the last change never dropped, so a growing 80k-node feed no longer drags the whole index back to disk on every change; a torn write can damage at most one feed, and a shard whose feed left the roster is ignored on restore. Execution metrics observed on a revisit are now checkpointed too (they previously never triggered a save). A legacy v2 single-file checkpoint is read once and migrated into shards; the old file is left in place for this release. Cache change events now say what they touched (`roster`, `feed`, `all`, `lifecycle`).
- c716624: Directory listings survive a restart. The listing cache is checkpointed (identity-keyed file under `~/.cache/chell/vfs/`, throttled writes) and restored at boot with each entry's original timestamp, so a restored listing is exactly as stale as it really is. Stale handling itself is fixed: the listing path used to serve any cached entry regardless of its TTL (a listing never refreshed until eviction or `ls -f`). Now a fresh entry serves as is; a stale one is served at once and revalidated behind itself when a host can carry the refresh (the daemon publishes the fresh `fs.listing` on the ambient bus, marked `fresh`), and is refetched in line at a plain console. `ls` models carry `fresh` per listing; `vfs.listing_get` exposes the listing with its freshness.
- Updated dependencies [920e0ac]
- Updated dependencies [7a0f06e]
- Updated dependencies [920e0ac]
- Updated dependencies [c716624]
- Updated dependencies [cece0dc]
- Updated dependencies [97af423]
  - @fnndsc/cumin@3.16.0
  - @fnndsc/salsa@3.11.0
  - @fnndsc/brasa@0.15.0
  - @fnndsc/menu@0.2.0
  - @fnndsc/calypso@0.8.0

## 5.4.1

### Patch Changes

- Updated dependencies [85791b3]
  - @fnndsc/brasa@0.14.0
  - @fnndsc/calypso@0.7.1

## 5.4.0

### Minor Changes

- 0adb4f2: The daemon terminal gets a resting state: the console face.

  The boot-phase brain animation repainted by cursor arithmetic against a
  scrolling buffer — counting rows printed beneath it and jumping up — so a
  retry warning landing mid-frame interleaved with the art, and the pulse had
  to kill itself the moment output scrolled the logo away: the brain went
  silent exactly when the daemon came alive.

  Boot is unchanged and text-first: the brain prints, pulses while
  credentials are checked, and every address and token scrolls into ordinary
  scrollback. What is new is what happens when boot completes on a TTY: the
  daemon switches to the alternate screen buffer — the same screen vim and
  htop own — where the brain pulses forever at fixed coordinates over an
  identity panel (identity, wire, ARGUS URL, token, berth, attach line,
  uptime, attached surfaces, index counts), with the last few log lines caged
  in a dim strip beneath. The pulse is honest: idle is a slow shimmer, an
  executing command quickens it, a surface attaching flares it.

  Esc or `q` drops to the normal buffer, restored byte-perfect with the boot
  log intact and the lines captured while the face was up flushed beneath it;
  any key returns. Ctrl-C stops the daemon from either mode. Off a TTY
  (systemd, nohup) nothing changes: sequential logging, as before.

  The brain art and its frame renderer moved from chell to brasa
  (`logo_frameRender`, `logo_linesRender`, and the new `logoRows_count` /
  `logoColumns_count`), so any surface can draw it; chell keeps only its
  boot-terminal animation host. `daemon_launch` now returns the launched
  daemon's addresses and handle, which both launch paths (`chell --daemon`
  and the standalone `calypso` binary) feed to the face.

- 9ed68cd: `download` no longer writes to the daemon host's disk. File delivery is now a
  surface capability, like prompting, piping and editing already were.

  The builtin resolved its destination with `path.resolve()` inside the engine,
  so the bytes landed on whatever machine hosted the engine. For a local shell
  that is right — the engine is in-process and the operator's disk is the
  engine's disk. Under a daemon it put files on a machine nobody attending the
  session was sitting at, and from a browser the question "download to where?"
  had no answer at all.

  `Surface` gains `fileDeliver`, and `SurfaceCapabilities` gains `fileDelivery`
  alongside `engineFilesystem` — which says whether a path the engine resolves is
  a path this surface's operator can open. Only an in-process local shell claims
  it. When it is false, `download` hands the file to the surface, which puts it
  somewhere its operator can actually reach: the client's disk for
  `chell --remote`, the download manager for `argus`.

  Only the request crosses the wire. Each surface fetches the bytes itself
  through the daemon's existing token-gated `/vfs` route, so a DICOM series is
  not base64'd across a channel meant for session state — the intent travels
  through the vocabulary and the bytes travel through the byte route.

  The local path is unchanged: a local `chell` still uses the existing transfer
  machinery, with its globs, directory walks and progress reporting.

  A directory has no bytes to hand over, and what to do about that depends on
  what the surface has — a third capability, `localFilesystem`, declared in the
  attach handshake and answered by the surface rather than by the daemon. A shell
  owns a filesystem wherever it runs, so `chell --remote` receives the tree file
  by file and gets the folder it asked for. A browser owns no directory and can
  take files only one at a time, so several hundred DICOM instances would be
  several hundred saves; for that surface alone a directory is archived into a
  single CUBE file first, through
  the registered `zip v20240311` pipeline — `pl-dircopy` into a zip plugin, the
  same mechanism the ChRIS web UI has used for years, but living in `brasa` where
  every surface reaches one implementation instead of each client re-deriving the
  sequence. `CHRIS_ARCHIVE_PIPELINE` names a different pipeline where a
  deployment registered one. When it is absent, the failure says which pipeline
  is missing and that it can be registered from the store.

  The archive run announces itself rather than creating a feed silently, because
  it is a workaround for CUBE having no directory-archive route: issue #233.

  `upload` has the mirror problem — it reads from the engine host's disk — and is
  not addressed here, because the browser direction needs a file picker. See
  issue #232.

- 976c753: `chell --remote` can attach to a daemon on another machine.

  `CALYPSO_BIND` has always opened the wire to the network, and the attach token
  has always gated the session — but _discovery_ is local. A berth is a file in
  one host's runtime directory, so a surface on another machine has none to read,
  and the berth recorded `ws://127.0.0.1:<port>` regardless of what the daemon
  bound. The wire was reachable and nothing could tell a remote `chell` where to
  point: a browser could attach and a terminal could not.

  `--attach` takes an explicit address and skips discovery:

  ```
  chell --remote --attach http://pangea:41234/?token=abc123
  ```

  The address is the one the daemon prints. The web surface and the wire share a
  port, so the ARGUS link names both and pasting it is the whole interaction;
  `--token` supplies the token separately where an address carries none, and
  `https`/`wss` are preserved. The berth is built in memory and never written,
  since another machine's daemon does not belong in this machine's berth
  directory.

  A daemon bound to anything but loopback now records a routable URL in its own
  berth and prints the ready-to-paste attach command beside the ARGUS link.

  This is not the `porter` server. There is no listener beyond the one
  `CALYPSO_BIND` already opened, no cross-host auth beyond the attach token, and
  no way to discover a daemon you were not told about.

- 8842ab4: Indeterminate progress now crosses the daemon wire as typed facts rather than
  terminal escapes.

  The spinner used to write `\r\x1b[K<frame>` and cursor hide/show to the status
  channel twelve times a second, so every attached surface received terminal
  choreography whether or not it was a terminal — a web surface had to emulate a
  character grid to recover the meaning, and got it subtly wrong. It now announces
  `operation: 'task'`, `kind: 'inspection'`, `phase: 'working'` with a label, and
  closes with `phase: 'complete'`. Each surface draws waiting in its own idiom.

  Only state changes cross the wire: frames and elapsed counters are the
  renderer's, so a spin of any length costs two events instead of dozens per
  second. `chell` gained the elapsed counter its spinner used to bake into the
  label, and `argus` gained a full progress renderer — indeterminate work spins,
  counted work fills a bar — which also surfaces the download progress it had
  been silently discarding.

  The `operation` and `phase` enums gained `task` and `working`. Every enum on
  the progress message now degrades on an unknown value instead of failing the
  parse and dropping the message whole: `operation` to `task`, `phase` to
  `working`, `status` to `unknown`, `kind` and `unit` to absent. That makes good
  the contract's promise that change within a major is additive — for future
  additions, since the fallback lives in the build doing the reading.

  The spinner keeps its call signature, so its callers are unchanged. Its
  `showTiming` and `clearLine` arguments are now ignored: both are rendering
  decisions. It also no longer inspects `process.stdout.isTTY` before announcing,
  which had suppressed progress inside the daemon, where the engine's own stdout
  is never a terminal but the attached surface may well be able to draw.

### Patch Changes

- eebdc7d: A daemon writes its attach addresses to a file, and keeps its boot animation.

  Stopping the brain-activity pulse in daemon mode made the terminal easy to
  select from and the session feel dead. The animation stays; the addresses are
  written where they can be read without fighting a repainting screen or
  surviving a `clear`.

  The note lands at `/tmp/calypso-<user>.attach`, and the banner names it. It
  carries the attach token, which is a credential, in a world-readable directory
  — so it is created `0600`, created exclusively so a symlink planted at the path
  makes the write fail rather than land somewhere of an attacker's choosing, and
  removed when the daemon exits.

  `calypso --berths` reads the same facts from the berth — `0600` in the user's
  own runtime directory — and remains the safer route for anything scripted.

- 5d131c8: A daemon's terminal stops repainting itself, and its attach addresses can be
  read back.

  `logo_animatePulse` starts a 100ms interval that saves the cursor, jumps up the
  screen, repaints the logo and restores — and it runs for as long as the process
  does. The interactive path stops it once boot finishes; the daemon path never
  did. So a daemon's terminal was being rewritten ten times a second forever,
  which made the banner it had just printed — the URLs and the attach token, the
  only thing anyone needs from that terminal — impossible to select.

  `calypso --berths` prints how to attach to every live daemon: the ARGUS link
  and the ready-to-paste `chell --remote --attach` command, per identity.

  The facts are read from the berth rather than copied to a more convenient
  place. A berth already holds the url and token at mode `0600` in the user's
  runtime directory; `/tmp` would be easier to reach and is world-readable, and
  the token is a credential.

- 58e3a37: A daemon boot keeps its normal buffer text-only, by law.

  The boot-phase pulse (revive-and-animate after login) could outlive the
  whole boot on a tall terminal, and its final repaint — cursor arithmetic
  over wrapped, ANSI-heavy lines — stamped the static brain over the daemon's
  token and attach lines, which the console face's Esc view then faithfully
  restored, mangled. Daemon mode now skips the revive entirely: the animated
  brain lives solely on the face's alternate screen, and the boot report and
  addresses survive verbatim for Esc. The interactive chell REPL keeps its
  boot animation unchanged.

- a3bd3e9: The console face now covers the whole daemon boot, in two phases.

  From warm-up on, the alternate screen shows the brain in a frenetic boot
  pulse over a tall strip of the streaming boot log — the messages are the
  point while the machine comes up. When the daemon is listening, the same
  screen settles in place into the steady instrument: calm ambient pulse,
  identity panel, live telemetry, and the closing hint "HIT ESC TO TOGGLE
  THE BOOT LOG". Esc toggles to the raw text log in either phase; any key
  returns.

  Along the way: the log ring now treats a carriage return as a redraw, so a
  spinner's thousand frames stay one line; the face steps aside
  (`face_suspend`/`face_resume`) when warm-up failure asks the operator a
  question, so the prompt's readline owns the terminal; and a boot dying with
  the face up flushes the ring — the abort reason included — into the normal
  buffer instead of vanishing with it. New calypso API: `face_boot`,
  `face_ready`, `face_suspend`, `face_resume`.

- 19a4d5b: The daemon boot experience, settled: classic boot, minimal face.

  Booting is the classic in-scroll experience again — the brain lights up at
  connect and the boot log with its in-stage progress scrolls beneath it
  (frames now paint as one buffered write, so concurrent log lines cannot
  tear the art). When the daemon is ready, the boot screen is replaced by a
  minimal console face on the alternate buffer: the animating brain,
  vertically centered, one status line (DAEMON RUNNING · SESSION ESTABLISHED,
  or ENGINE EXECUTING while a command runs), and the Esc hint. Nothing else.
  Esc shows the verbatim text record — boot log, addresses, token — which the
  ready handoff now halts the pulse without repainting, so it can never again
  be stamped over; any key returns to the brain.

- 7672c6e: Two regressions found by running a daemon.

  **The boot animation fed its own position counter.** The pulse repaints through
  `process.stdout.write`, which is what the row counter hijacks. Counting
  newlines it was accidentally safe, since a repaint emits none; counting screen
  rows it was not, because each repaint writes thirty lines with no newline and
  the pending-column position accumulated. The offset grew by roughly 380 rows a
  second, and the logo climbed the screen painting over everything above it. The
  animation now writes through the unhijacked handle, and a test asserts the
  counter does not move while it runs — against the broken version it moved 762
  rows in two seconds.

  **Daemon boot showed no spinners.** Warm-up runs before the daemon installs its
  own sink, so the engine is still writing to the terminal it is booting in — but
  nothing installed a progress renderer there, and the migrated spinner's typed
  events went into `StdoutSink`'s null renderer. Before the spinner emitted typed
  events it wrote escapes straight to the status channel, so this only appeared
  once it stopped doing that, and only in daemon mode. Warm-up now installs a
  terminal renderer when the session is interactive.

- 79fdd4a: The brain lights up on a clear screen when credentials are accepted.

  The pulse repaints by moving the cursor up to where the logo is, so the logo
  must still be on screen. By the time login finishes it usually is not — the
  logo and the login output have scrolled past the top — and an animation that
  cannot reach its anchor paints at row zero instead, over the boot report and
  the daemon's own addresses. The flickering brain and the mangled banner were
  the same defect.

  `logo_reviveOnScreen` homes the cursor, clears below it, and redraws the logo
  alive at row zero. The anchor is restored and boot output has a whole screen to
  flow into beneath it, so the animation runs through warm-up and the banner
  without reaching anything else.

  It also restores the sequence the animation existed for: the brain is dead
  while credentials are checked, and comes to life once they are good.

- bcd9c5c: The boot animation stops before it can paint over what a daemon prints.

  The pulse repaints by moving the cursor up a fixed number of rows, which holds
  only while the logo is still on screen. A daemon boot prints far more than a
  window holds — the logo, the warm-up panels, then the addresses — and once the
  buffer scrolls, moving up clamps at row zero. The logo is then painted over
  whatever is visible there, which is the ARGUS link and the attach token it had
  printed a moment earlier.

  No arithmetic recovers an anchor that has scrolled away, so the animation now
  stops while it is still correct: it runs while the logo is on screen and holds
  still once output has pushed it past the top.

- e86b5df: The boot animation no longer paints over long output.

  The pulse repaints the logo by moving the cursor up a fixed number of rows, and
  it counted rows by counting newline characters. A line longer than the terminal
  is wrapped into several screen rows while contributing one newline, so the
  count under-shot and the animation painted on top of whatever had been printed.

  The daemon banner made it plain: its identity line and its ARGUS URL, which
  carries a 64-character token, both wrap — and both were the lines that came out
  mangled.

  Rows are now counted as rows, with escapes stripped so cursor and colour codes
  do not inflate a width, and with the column position carried across writes that
  do not end in a newline.

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

- Updated dependencies [1d600ac]
- Updated dependencies [eebdc7d]
- Updated dependencies [5d131c8]
- Updated dependencies [0adb4f2]
- Updated dependencies [31c2a50]
- Updated dependencies [a78b5ee]
- Updated dependencies [1c195a7]
- Updated dependencies [a3bd3e9]
- Updated dependencies [19a4d5b]
- Updated dependencies [9ed68cd]
- Updated dependencies [790f994]
- Updated dependencies [e58bf58]
- Updated dependencies [e062dbf]
- Updated dependencies [87f7c59]
- Updated dependencies [56ade16]
- Updated dependencies [2bb9c29]
- Updated dependencies [3125517]
- Updated dependencies [28b9a9f]
- Updated dependencies [976c753]
- Updated dependencies [8842ab4]
- Updated dependencies [2c38d8b]
- Updated dependencies [bf09355]
- Updated dependencies [b39b584]
  - @fnndsc/salsa@3.10.0
  - @fnndsc/brasa@0.13.0
  - @fnndsc/calypso@0.7.0
  - @fnndsc/cumin@3.15.0

## 5.3.3

### Patch Changes

- Updated dependencies [0ad04f2]
- Updated dependencies [1928d4b]
  - @fnndsc/brasa@0.12.0
  - @fnndsc/calypso@0.6.0

## 5.3.2

### Patch Changes

- Updated dependencies [14f8ee8]
- Updated dependencies [4da2673]
- Updated dependencies [69b0617]
- Updated dependencies [7ed8e1c]
- Updated dependencies [7dc3bca]
  - @fnndsc/cumin@3.11.0
  - @fnndsc/salsa@3.7.0
  - @fnndsc/chili@3.6.5
  - @fnndsc/brasa@0.11.0
  - @fnndsc/calypso@0.5.1

## 5.3.1

### Patch Changes

- 5285bd5: Cast burndown to the adapter floor. The wire contract gains the pipelines
  surface (`pipeline_get` with piping items and plugin metadata handles,
  `pipelineSourceFilesPage_get`); salsa's pipeline modules, feed joins, and
  brasa/chili call sites migrate onto typed accessors and honest converters.
  The repository's `as unknown as` count is now 2, both inside the licensed
  adapter seam, and the CI ratchet holds it there. chell progress bars also
  draw on the renderer's configured stream instead of assuming stdout.
- Updated dependencies [5285bd5]
- Updated dependencies [919648f]
  - @fnndsc/cumin@3.10.0
  - @fnndsc/salsa@3.6.1
  - @fnndsc/chili@3.6.4
  - @fnndsc/brasa@0.10.1

## 5.3.0

### Minor Changes

- 67377a3: Unify the five correlation-id request/reply implementations onto one `RequestBroker`. The daemon's four surface-delegated brokers (prompt, pipeline segment, host shell, edit) and the remote client's own pending-request map previously each reimplemented the id/pending/close lifecycle with divergent correctness; all five now share one class that uniformly guarantees origin-validated settles (no surface can answer another surface's prompt), close-listener removal on settle (no per-request listener leak), and rejection when the origin disconnects. The protocol gains optional `promptError` and `editError` messages (additive, no version bump) so a surface can report a failed or impossible prompt or edit. Behavior change on the remote surface: a client without a prompt, pipe, or edit handler now reports the inability as an error instead of silently answering empty, passing pipe input through unchanged, or returning an unchanged "successful" edit.
- b2f5ad3: Greet every surface with the stack's identity. Builds now record the short git hash they were produced from (`dist/buildinfo.json`, written by the new `scripts/buildinfo.mjs` build step), and brasa exposes it through `buildHash_get` alongside `welcomeLine_build`/`welcomeLine_compose`, which render a banner of the form `ChELL Executes Layered Logic, v 5.3.0 (886f09). Welcome.` An interactive chell session prints the banner and a short fortune at boot, the calypso daemon announces its banner plus an aligned version line for every stack layer (chell, brasa, chili, salsa, cumin, calypso) when it starts listening, and the attach handshake gains an optional `stack` field carrying all six versions and the build hash, so a remote surface banners the daemon's full reported stack rather than its local install's. `fortune_random` is exported for reuse, with an optional line-count bound so banners favour short cookies.

### Patch Changes

- 2e60785: Cache the `/etc/group` projection per CUBE connection for five minutes,
  invalidate it after ChELL membership changes, and show semantic inspection
  progress while an uncached projection is resolving.
- 66bc932: Add ChELL group membership commands and include current CUBE usernames in the
  live `/etc/group` projection.
- 8ec8a4b: Add explicit, command-scoped CUBE elevation with `sudo <command>`. The active surface collects an administrator identity and hidden password; a temporary CUBE client runs only the nested command, then the normal session is restored. Group membership and plugin registration now suggest a copyable `sudo` rerun after an authorization failure, and plugin registration no longer owns a separate interactive admin prompt.
- d0ac04f: Preserve failure causes and tighten cache contracts. Errors that were replaced by generic messages now carry their real cause: controller and handler creation failures name the underlying error instead of "no ChRIS context", `cat` shows the actual fetch failure, docker command failures surface stderr detail, context-set errors actually print, settings load/save failures are announced instead of silently using defaults or losing changes, unreadable berth and discovery files are named instead of reading as "no daemon", token-file read errors are distinguished from the logged-out state, and resource deletes report why they failed. Every remaining deliberate error absorption now carries a dated adjudication comment. Cache contracts: the PACS provider's decoded-query cache caches settled results only and is size-bounded; the object-context factory gains an eviction hook (`objContext_evict`) for deleted plugin or feed ids; `mv` and `cp` invalidate the whole affected listing subtree; and a new PACS query invalidates the cached `/net/pacs/queries` listing so it appears in the next `ls` immediately.
- 50e9bb1: Make CUBE group membership commands name-first and batch-capable. `group members`, `group inspect`, `group adduser`, and `group removeuser` now accept an exact group name or a numeric ID; add and remove accept multiple usernames, report every result, and make already-satisfied membership changes successful no-ops.
- d0ac04f: BEHAVIOR CHANGE: failures no longer read as empty results. Commands that previously printed nothing and exited 0 when a fetch failed now report the error and exit non-zero, following the codebase's `Result<T>` pattern throughout. Affected surfaces: listing a PACS study or series that does not exist errors instead of showing an empty directory; `store list`/`store search` and `compute list` error when the store or CUBE is unreachable instead of showing no entries; plugin registration no longer defaults to the `host` compute resource when the compute fetch failed; `rm` on a feed fails when running jobs could not be cancelled instead of claiming success; a recursive scan that cannot list a subtree reports the exclusion instead of silently omitting it; batch job-status gaps and disconnected status fetches push visible warnings; the native VFS distinguishes "folder absent" from "could not verify" so probe failures no longer masquerade as missing directories; `cp` fails when path resolution fails rather than proceeding with a guessed path; join-edge resolution retries after a transient failure instead of permanently recording no joins; and the remote client reports invalid daemon messages instead of silently dropping them. Exit codes are now truthful end to end: `ls` reports an error status when any listing fails instead of aggregating failures into success, and `chell -c` derives its exit code from the command's envelopes, so a failed one-shot command exits non-zero even when the builtin did not set an exit code itself.
- ac69b3e: Run ChELL shell escapes on the originating surface, including remote clients,
  instead of exposing the CALYPSO daemon host process and filesystem.
- 0e92d4d: Persist and reconcile daemon `/proc` checkpoints, fix wildcard listing of
  virtual executables, keep remote admin prompts on their originating surface,
  add a Unix-style `id` builtin for the current CUBE UID/GID projection and group
  memberships, and make versioned-plugin help, parameters, and README output
  compose correctly through terminals, pipes, and redirects.
- fa81126: Retain failed `/proc` topology sweep state and add `proc retry` to continue at
  the failed page without repeating already successful pagination work.
- Updated dependencies [2e60785]
- Updated dependencies [66bc932]
- Updated dependencies [8ec8a4b]
- Updated dependencies [d0ac04f]
- Updated dependencies [886f09c]
- Updated dependencies [3cde784]
- Updated dependencies [50e9bb1]
- Updated dependencies [d0ac04f]
- Updated dependencies [22db63f]
- Updated dependencies [ac69b3e]
- Updated dependencies [0e92d4d]
- Updated dependencies [67377a3]
- Updated dependencies [590a943]
- Updated dependencies [fa81126]
- Updated dependencies [b2f5ad3]
  - @fnndsc/salsa@3.6.0
  - @fnndsc/brasa@0.10.0
  - @fnndsc/cumin@3.9.0
  - @fnndsc/chili@3.6.2
  - @fnndsc/calypso@0.5.0

## 5.2.13

### Patch Changes

- Restore Unix-fast `cat /bin/<pipeline>` semantics and expose complete,
  potentially remote Pipeline inspection through `pipeline manifest` and the
  direct executable's `--manifest` alias.
- Updated dependencies
  - @fnndsc/brasa@0.9.9
  - @fnndsc/salsa@3.5.5

## 5.2.12

### Patch Changes

- Show a delayed, ephemeral `Reading registered pipeline…` spinner on stderr
  for slow interactive `/bin` Pipeline reads; keep pipes, redirects, and fast
  cache hits silent.
- Updated dependencies
  - @fnndsc/brasa@0.9.8
  - @fnndsc/calypso@0.4.5

## 5.2.11

### Patch Changes

- Keep the cold `cat /bin/<pipeline>` remote request count independent of node
  count and make repeated reads connection-cache hits.
- Updated dependencies
  - @fnndsc/brasa@0.9.7
  - @fnndsc/salsa@3.5.4

## 5.2.10

### Patch Changes

- Ship pipeline runtime overlays, registered `/bin` manifests, per-node
  compute/resource controls, and PACS plugin/pipeline attachment.
- Updated dependencies
  - @fnndsc/brasa@0.9.6
  - @fnndsc/cumin@3.8.4
  - @fnndsc/salsa@3.5.3

## 5.2.9

### Patch Changes

- Specify per-node pipeline runtime parameters, serializable parameter overlays,
  and the Unix boundary that keeps loops and other general programming in the
  calling shell.

## 5.2.8

### Patch Changes

- Document the planned PACS pull attachment contract for explicitly adding one
  plugin or pipeline to a newly created feed.

## 5.2.7

### Patch Changes

- Add `pacs pull --new-feed "TITLE"` to retrieve a selected PACS series set and
  create one analysis feed rooted in the resolved CUBE directories.
- Updated dependencies
  - @fnndsc/brasa@0.9.5
  - @fnndsc/cumin@3.8.3
  - @fnndsc/salsa@3.5.2

## 5.2.6

### Patch Changes

- Add controllable syntax highlighting to `cat`, including Python and other
  popular source/configuration formats, while keeping ordinary pipes and
  redirects ANSI-free.
- Updated dependencies
  - @fnndsc/brasa@0.9.4

## 5.2.5

### Patch Changes

- Carry cold, cached-refresh, and failed `/proc` lifecycle state through the
  CALYPSO prompt contract; reorder p10k segments and render distinct lifecycle
  clues for local and remote surfaces.
- Updated dependencies
  - @fnndsc/cumin@3.8.2
  - @fnndsc/brasa@0.9.3
  - @fnndsc/calypso@0.4.4

## 5.2.4

### Patch Changes

- 1930297: Abbreviate the authenticated user's home directory as `~` in both prompt
  themes and refresh their shared palette with vivid Powerlevel10k-inspired
  truecolor accents and high-contrast Font Awesome prompt icons.

## 5.2.3

### Patch Changes

- 6f0833a: Release the coordinated ChELL stack with deterministic `/proc` topology progress, complete visible-feed indexing, safe warm-up query gating, remote one-shot command completion, and refreshed daemon documentation.
- Updated dependencies [6f0833a]
  - @fnndsc/cumin@3.8.1
  - @fnndsc/salsa@3.5.1
  - @fnndsc/chili@3.6.1
  - @fnndsc/brasa@0.9.2
  - @fnndsc/calypso@0.4.3

## 5.2.2

### Patch Changes

- 71a6cd4: Route a pipeline executable's bare `--signalflow` flag to SignalFlow diagram output and provide contextual help for dynamic pipeline commands. Keep final-segment redirection on the originating surface, propagate remote pipe-segment failures back to the engine, and prevent remote command errors from terminating the interactive ChELL client. Daemon mode now reports shared startup cache warming and publishes its listening berth only after engine readiness. Consistently document `signalflow -` for stdin rendering.
- Updated dependencies [71a6cd4]
  - @fnndsc/brasa@0.9.1
  - @fnndsc/calypso@0.4.2

## 5.2.1

### Patch Changes

- Updated dependencies [e630f79]
- Updated dependencies [e630f79]
  - @fnndsc/brasa@0.9.0
  - @fnndsc/cumin@3.8.0
  - @fnndsc/salsa@3.5.0
  - @fnndsc/calypso@0.4.1

## 5.2.0

### Minor Changes

- 50d0680: Run several CALYPSO daemons on one machine — one per CUBE identity — driven by the
  same `--daemon` / `--remote` verbs:

  ```
  chell --daemon me@https://cube/api/v1/ -p pw       # my daemon
  chell --daemon them@https://cube/api/v1/ -p pw     # their daemon (isolated)
  chell --remote me@https://cube/api/v1/             # attach to MY daemon
  chell --remote                                     # sole berth attaches; picker if several
  ```

  Daemon discovery is now keyed by identity: each daemon advertises a **berth**
  (`{ identity, url, token }`) under `$XDG_RUNTIME_DIR/calypso/` (falling back to the
  system temp dir), `0700` on the directory and `0600` on each file. `--daemon` refuses
  to start a second daemon for an identity that is already live, pointing at the
  running one instead. Bare `--remote` attaches the sole live berth, offers an
  interactive picker when several are running, and requires an explicit
  `<user>@<url>` in a non-interactive context.

  All berth lookup goes through a `BerthResolver` seam (`resolve`, `list`), with a
  `LocalBerthResolver` over the runtime files and an injected liveness probe that
  reaps berths whose daemon has gone. The seam leaves room for a future network
  resolver without any surface change.

### Patch Changes

- Updated dependencies [50d0680]
  - @fnndsc/calypso@0.4.0

## 5.1.4

### Patch Changes

- Updated dependencies [8ac7ef9]
  - @fnndsc/brasa@0.8.0
  - @fnndsc/calypso@0.3.7

## 5.1.3

### Patch Changes

- Updated dependencies [a1f6694]
- Updated dependencies [01ab743]
- Updated dependencies [b8ae635]
- Updated dependencies [ca63e8b]
  - @fnndsc/cumin@3.7.0
  - @fnndsc/salsa@3.4.0
  - @fnndsc/brasa@0.7.0
  - @fnndsc/calypso@0.3.6

## 5.1.2

### Patch Changes

- 4043a96: Align the `pacs pull` per-series progress bars. The series name and status are now rendered as fixed-width columns — the name column grows to the widest series and already-drawn bars (including finished ones) re-pad to match — so every progress bar starts at the same column and the bars line up vertically instead of stepping in and out with each series' name and status length.
- Updated dependencies [e5a30f7]
  - @fnndsc/brasa@0.6.0
  - @fnndsc/calypso@0.3.5

## 5.1.1

### Patch Changes

- Updated dependencies [c2087d0]
  - @fnndsc/brasa@0.5.0
  - @fnndsc/calypso@0.3.4

## 5.1.0

### Minor Changes

- 880d37a: `chell --version` reported brasa's version in place of chell's: the version module moved into brasa during the engine split but still read its own `package.json` as "chell", so it printed brasa's number. It now resolves every package by name (reading brasa's own directly) and reports the full stack — chell, brasa, chili, salsa, cumin, calypso — with versions aligned in a column. A new `chell --info` flag prints a role-grouped table (surfaces / engine / layers) of each package, its full name, and version. The version report, the `--info` table, and the boot panel all draw from a single source of truth in brasa (`stackInfo_get`), and the standalone binary inlines every stack version at build time.

### Patch Changes

- Updated dependencies [512e14f]
- Updated dependencies [880d37a]
- Updated dependencies [e43f42a]
  - @fnndsc/brasa@0.4.0
  - @fnndsc/chili@3.6.0
  - @fnndsc/calypso@0.3.3

## 5.0.2

### Patch Changes

- Updated dependencies [a0d3df5]
- Updated dependencies [a0d3df5]
  - @fnndsc/brasa@0.3.0
  - @fnndsc/chili@3.5.0
  - @fnndsc/calypso@0.3.2

## 5.0.1

### Patch Changes

- Updated dependencies [d69b086]
- Updated dependencies [d69b086]
  - @fnndsc/brasa@0.2.0
  - @fnndsc/chili@3.4.0
  - @fnndsc/calypso@0.3.1

## 5.0.0

### Major Changes

- c824000: chell is now the CLI surface over the new `@fnndsc/brasa` engine package. The shell engine (parser, dispatch, pipes, builtins, session, output) was lifted into brasa; chell keeps the readline REPL, terminal rendering, and prompt themes.

  Breaking: the `calypso` daemon binary is no longer provided by chell — it now ships with `@fnndsc/calypso`. Install that package to run the daemon (`chell --daemon` continues to work). Prompt themes now render per-surface from a pushed context rather than as a server-rendered string.

### Patch Changes

- Updated dependencies [c824000]
  - @fnndsc/calypso@0.3.0

## 4.4.0

### Minor Changes

- 55d2dab: Capture bridge for legacy printing builtins: `CaptureSink` (data and err buffered, status passed live so spinners stay visible) and `printingHandler_wrap`, which runs a printing handler under capture and returns its output as an envelope with status derived from the exit code. The resource-group commands (feed, plugin, compute, tag, group, pluginmeta, plugininstance, workflow, files, links, dirs, context, parametersofplugin, and aliases) now flow through the bridge: envelope semantics, identical bytes, typed models deferred until a structural consumer exists.
- aa81b0a: Add the error stream to the envelope contract and convert the first fs builtins. `CommandEnvelope` gains `renderedErr` (printable stderr text, ANSI permitted), keeping the error stream separate from pipeable data; `envelope_error` accepts it as a third argument; the structured `errors` field is machine-facing and no longer presented by delivery. chell's `OutputSink` gains `err_write` (stdout sink routes to stderr; capture sink passes through uncaptured, matching today's pipe semantics). Builtins converted: `cd`, `mkdir`, `touch` (models `fs.cwd`, `fs.mkdir`, `fs.touch`), rendered and error-stream bytes identical to the previous behavior.
- 2f2f6d3: `calypso` is now its own command. It is `chell --daemon` under a dedicated name — hosting one engine over a loopback WebSocket for remote surfaces to attach to — and shares chell's entire connection surface: the `user@url` shorthand, `--user`, and the hidden password prompt all work exactly as they do for `chell` (bare `calypso` inherits the saved session; `calypso rudolphpienaar@http://cube/api/v1/` prompts and connects at startup). Attach a surface with `chell --remote`. The DEP0169 warning suppression shared by both entry points moved into `core/warnings.ts`, and `chell_start` now accepts an argv override so the `calypso` entry can force daemon mode without duplicating the bootstrap.
- 30a3e1e: Interactivity over the wire: a builtin that prompts during a remote command now reaches the surface running it. The contract gains a `prompt` request (daemon→surface, with hidden-input support) and a `promptAnswer` reply (surface→daemon). The daemon serializes execution across the whole session so a mid-command prompt has one unambiguous target, and exposes an input broker (`prompt_current`) the host wires into its `Surface`; the `chell --daemon` launcher installs a surface whose `prompt` delegates to it, so `repl_question` (passwords, confirmations, the plugin admin flow, the prompt configurator) works over the wire unchanged. The `chell --remote` client answers incoming prompt requests from its own terminal (hidden when asked) and replies. Completion already round-trips from the earlier daemon work; the themed pushed prompt string and client-side pipe-segment execution remain follow-ups.
- 93e604f: Run pipeline segments on the surface, never on the daemon host. Segment execution becomes a surface capability: the `Surface` gains `pipeSegments` (a capability flag) and a `pipeSegment(command, input)` method. The local CLI runs segments in-process exactly as before (byte-identical); the daemon's surface routes them over the wire (new `pipe`/`pipeResult` messages, base64 for the bytes) to the surface running the command, which runs them on its own machine — so a pipeline like `ls | grep foo` never spawns anything on the daemon host, closing that attack surface. A surface without the capability (a browser) fails such pipelines with a clear message. Completes the interactivity work: prompts, completion, the pushed prompt string, and pipe segments all now work over the wire.
- f492dd9: Push the themed prompt string to remote surfaces. Only the daemon holds the session context the prompt renders, so it renders the prompt and pushes it (a new `promptline` message) to every surface on attach and after each command — the context may have changed. A surface prints what it receives, so prompt themes look identical whether the session is local or remote. chell factors prompt rendering into a shared `sessionPrompt_render` used by both the local REPL and the daemon's `promptProvider`; the `chell --remote` client renders the latest pushed prompt (falling back to a fixed string until the first push), replacing the placeholder prompt it showed before.
- 7cee888: The surface owns the local editor, so `edit` works over the wire. The `Surface` gains a `localEdit(content, extension)` method (resolving the flag-only deferral from the prompt-capability work): the CLI surface backs it with the temp-file-and-`$EDITOR` mechanics that used to live in the `edit` builtin, and the daemon backs it by routing to the surface running the command (new `edit`/`editResult` messages + an `edit_current` broker) so the operator's own editor opens, never one on the daemon host. The `edit` builtin no longer touches processes or temp files for editing — it fetches the file, hands the content to `surface.localEdit`, and uploads the result; `chell --remote` opens the client's editor. A surface without the `localEdit` capability (a browser) fails `edit` with a clear message.
- 8bb7ec5: Add `chell --daemon` and `chell --remote`: the same REPL now drives either an in-process engine or a CALYPSO daemon over the wire. `chell --daemon` hosts the connected engine behind a daemon (forcing color on, silencing the daemon's own console, and advertising its URL + attach token in a user-only-readable discovery file for same-user attach); `chell --remote` discovers that daemon and attaches as a surface. The transport swap is a new `RemoteEngine` that implements the engine interface over the WebSocket contract and delivers received envelopes to the sink exactly as the in-process engine delivers live, so the REPL is unchanged — proving the sibling-surfaces topology (two remote shells on one daemon each see the other's commands via the session bus). This is the first place chell depends on `@fnndsc/calypso`.
- 2099ff6: Make the error stack async-context aware and drain it per command. cumin's `errorStack` gains `scope_run` (run work against an isolated stack), `checkpoint_mark`, and `checkpoint_drain`: fire-and-forget background work (topology warm-up, background cache refresh) now runs inside its own scope so its error traffic cannot land in a concurrent foreground command's drain window. chell's dispatch checkpoints the stack before each command and drains anything pushed above the checkpoint into the envelope's `errors` field, escalating status to `error` when a genuine error was left on the stack — a reliable per-command failure signal that also retires the exit-code-delta status heuristic's blind spot (a later failing batch segment no longer reads `ok`). CLI behavior is byte-identical.
- 60cbd8e: Extract the engine facade (`engine_create`, `line_execute`, `line_complete`, `ChellEngine`): line-level orchestration — shell escape, semicolon batching, redirects, pipes — now lives in `core/engine.ts` and yields one `CommandEnvelope` per executed command, while output continues to reach the active sink live. The REPL shrinks to a thin host (read line → engine → sink), dispatch gains envelope-producing execution (`command_dispatchEnvelope`, `command_executeToEnvelope`, `redirect_execute`, `pipe_execute`), and the unknown-command chili fallback now runs through the capture bridge so it too produces envelopes. Observable CLI behavior is byte-identical.
- 363bff0: Bridge second batch of printing builtins into envelopes (ls, tree, du, help, proc, logout, cubepath, query). Unbridge plugin: its add flow prompts for admin credentials through readline, which capture would make invisible; it stays a direct printer until the prompt capability lands with the engine facade.
- d302511: Introduce the output sink seam (`OutputSink`, `StdoutSink`, `BufferSink`, `envelope_deliver`, `envelopeHandler_wrap`): command output now leaves the engine through a host-installed sink instead of builtins assuming a terminal. The REPL installs a stdout sink, preserving CLI behavior exactly. First builtins converted to envelope returns (`pwd`, `whoami`, `whereami`), registered in the dispatch table through the compatibility wrapper and exposed raw via the new `ENVELOPE_HANDLERS` registry for envelope-aware hosts. See docs/calypso.adoc.
- 99c65e1: Convert timing, physicalmode, and debug builtins to envelope returns (typed models `sys.timing`, `sys.physicalMode`, `sys.debug`; rendered text byte-identical). Rename the sink channel methods to the project's RPN convention: `OutputSink.data_write` and `OutputSink.status_write`.
- b90a9cc: Pipes and redirects consume envelopes. The capture seam now feeds pipe chains and redirect targets from envelope-speaking commands' rendered text with ANSI stripped (plain pipes, the documented deviation from historical escape-byte leakage), passes error-stream text live to stderr, and still captures direct stdout writers such as binary cat. Legacy printing commands keep the old capture path unchanged.
- 5a2c448: Make interactivity a declared surface capability. A new surface seam (`core/surface.ts`) is the input-side counterpart to the output sink: a host installs a `Surface` that declares what interaction it can offer (`hiddenInput`, `localEdit`, `tty`) and backs prompting, and a builtin can require a capability via `capability_require` and fail with a clear message instead of hanging on a standard input that is not there. The CLI host installs a readline-backed surface (`core/cliSurface.ts`) — persistent on the REPL's interface, one-shot in execute/script modes — preserving the single-readline, no-echo-leak discipline. `question.ts`'s `repl_question` / `repl_questionHidden` now delegate to the active surface (salsa's admin-prompt flow and the prompt builtin are unchanged), and the `edit` builtin declares its need for `localEdit`. CLI behavior is byte-identical.
- 657311f: Convert cat to envelope returns (model `fs.cat` with per-file outcomes; text content buffered into rendered, binary content streamed with backpressure as before, auto-detection notice emitted live on the err channel so it precedes the bytes). Route the spinner through the sink's status channel: byte-identical on a terminal today, and positioned so transient frames never enter envelopes, pipes, or remote data streams.
- 2f2f6d3: Add a `version` command inside the shell. Typing `version` at the chell prompt (or `chell -c version`, and over a CALYPSO daemon via `chell --remote`) now prints the same stack report as `chell --version` — chell plus the chili/salsa/cumin layers — as a typed `sys.version` envelope, instead of falling through to chili as an unknown command. The version-report logic that both `--version` and the boot panel already shared moved into `core/version.ts` so the new command reuses it rather than duplicating the package.json loading.
- afde0e8: Convert cp, mv, and rm builtins to envelope returns (models `fs.cp`, `fs.mv`, `fs.rm` with per-target outcomes; rendered and error-stream bytes identical). Interactive `rm -i` streams live through the sink so confirmation prompts stay in sequence; non-interactive output is buffered into the envelope.

### Patch Changes

- 2f2f6d3: Fix `exit` from a remote surface tearing down the whole CALYPSO daemon. The REPL now treats `exit` as a shell-quit at the surface layer (closing readline) instead of forwarding it to the engine; for a `chell --remote` surface this detaches the client while the daemon — and any other attached surfaces — keep running. Previously `exit` reached the daemon's dispatch and called `process.exit`, killing every surface. Local interactive `exit` is unchanged apart from now printing the same goodbye line as Ctrl-D.
- Updated dependencies [aa81b0a]
- Updated dependencies [f8e0233]
- Updated dependencies [30a3e1e]
- Updated dependencies [93e604f]
- Updated dependencies [f492dd9]
- Updated dependencies [7cee888]
- Updated dependencies [e293d97]
- Updated dependencies [38df08f]
- Updated dependencies [2099ff6]
- Updated dependencies [c47ff22]
  - @fnndsc/cumin@3.5.0
  - @fnndsc/calypso@0.2.0

## 4.3.2

### Patch Changes

- Example accession numbers in help text replaced with clearly fake values.
- Updated dependencies
  - @fnndsc/salsa@3.2.6

## 4.3.1

### Patch Changes

- PACS query polish: a zero-match query completes in seconds through the "no studies found" path instead of spamming per-poll errors and riding the 60s timeout; browse/pull hints are suppressed when nothing matched; the spinner erases to end-of-line so shorter status messages no longer show the tail of longer ones.

## 4.3.0

### Minor Changes

- chell expands `$NAME` / `${NAME}` environment references in command arguments, making scripts parameterizable. `--version` now reports the chili/salsa/cumin versions in use. Fixes: `pull` re-pull of a series (query title collision), `pull` with a query expression (CWD was corrupting the first DICOM key), silent `query` failures now print the error stack, and `-e` aborts `-f` scripts with a non-zero exit when a command fails. New `exemplars/` reference programs and scripts (repo only, not packaged).

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fnndsc/chili@3.3.0
  - @fnndsc/cumin@3.4.0

## 4.2.12

### Patch Changes

- Test coverage lock-in: global coverage ratchets raised and a 60% per-file floor enforced in CI. No runtime changes.
- Updated dependencies
- Updated dependencies
  - @fnndsc/cumin@3.3.0
  - @fnndsc/salsa@3.2.5
  - @fnndsc/chili@3.2.6
