# @fnndsc/calypso

## 0.13.2

### Patch Changes

- 4af65f4: The daemon now tells a browser how long it may keep what it serves. It sent a content type and nothing else, and silence is not neutral: with no `cache-control`, no `etag` and no `last-modified` a browser may keep the page, and `index.html` is the file that names the hashed assets — so a kept copy pinned the whole surface to the build that wrote it and no rebuild ever arrived. `index.html` is `no-store`, a hashed asset is immutable for a year since a different build is a different URL, and anything else revalidates.
- Updated dependencies [163e4b1]
- Updated dependencies [aa923c6]
- Updated dependencies [59aa79b]
  - @fnndsc/brasa@0.22.0
  - @fnndsc/cumin@3.22.0

## 0.13.1

### Patch Changes

- Updated dependencies [7c793ad]
- Updated dependencies [7c793ad]
- Updated dependencies [af2df66]
- Updated dependencies [af2df66]
- Updated dependencies [0eb202f]
- Updated dependencies [183bf02]
  - @fnndsc/brasa@0.21.0
  - @fnndsc/menu@0.8.0
  - @fnndsc/cumin@3.21.1

## 0.13.0

### Minor Changes

- ef4a718: The standalone `calypso` binary ends its boot at a login, like `chell --daemon`: on a TTY the daemon's own terminal becomes its first surface, an ordinary `chell --remote` spawned onto it, rather than the old resting face. The console loop, the cage and the reattach grammar move into calypso (the daemon's own package), with the surface launch injected — chell spawns itself, the calypso binary spawns `chell` from the path — so both hosts share one console. Off a TTY neither attaches; the daemon just keeps listening.

## 0.12.0

### Minor Changes

- 9c320a0: The boot ends at a login. An interactive `chell --daemon` no longer rests on the console face: once the daemon is listening it puts an ordinary `chell --remote --attach` surface on its own terminal, as a child on the wire, so the boot log runs straight into a prompt. `exit` detaches and leaves the daemon running, Enter attaches again, Ctrl-C at the idle terminal stops the daemon, and whatever the daemon writes while a surface holds the terminal is held (calypso `consoleCage_start`/`consoleCage_stop`) and printed on detach. Every chell REPL, local or remote, now guards its idle prompt: a stray line (another surface's output, a late warm-up) lands on its own line with the prompt redrawn beneath it.

  The boot readout is lifted with it. A warm-up step running behind the prompt printed its pending row twice and never reported an outcome; it now prints once as `[PENDING]` and settles on the daemon's readout as `[ OK ]` with what it cached or `[FAIL]` with why. Every count takes its noun in the right number (`1 PACS query`, `3 feeds`) through a new brasa `count_noun`. The daemon banner writes every package out in full (brasa `stackBanner_build`/`stackBanner_compose`), adds an ARGUS row when a web surface is served, and drops the welcome; the remote surface banners the daemon's stack the same way. A daemon bound on every interface advertises its fully qualified host name.

### Patch Changes

- 89d3287: Daemon boot leaves no open `[PENDING]` row. The steps that warm behind the prompt were settling after the login took the terminal, which caged them, so their `[ OK ]` never reached the row and it stayed `[PENDING]` on screen. The boot now waits those steps out before the login — they settle in place, every row reading `[ OK ]` or `[FAIL]` — while the daemon is already listening, so nothing reaches it any later for the wait. The startup banner keeps its version column clean: the build hash moves from the CALYPSO row, which it pushed past the column the other rows share, to the `listening` line. The fortune is gone from daemon startup.
- Updated dependencies [3d11f59]
- Updated dependencies [9c320a0]
- Updated dependencies [711e1b3]
- Updated dependencies [d89e31b]
  - @fnndsc/brasa@0.20.0
  - @fnndsc/cumin@3.21.0
  - @fnndsc/menu@0.7.0

## 0.11.0

### Minor Changes

- 49634f2: feat(calypso): the telemetry heartbeat carries the lane — the command holding it, for how long, how many wait behind it — and CUBE's pace
- 2545ffa: feat(calypso): the telemetry heartbeat carries the lab's pulse the engine snapshots

### Patch Changes

- Updated dependencies [49634f2]
- Updated dependencies [49634f2]
- Updated dependencies [49634f2]
- Updated dependencies [2545ffa]
- Updated dependencies [2545ffa]
  - @fnndsc/brasa@0.19.0
  - @fnndsc/cumin@3.20.0
  - @fnndsc/menu@0.6.0

## 0.10.2

### Patch Changes

- Updated dependencies [6cd5ab1]
- Updated dependencies [6cd5ab1]
- Updated dependencies [6cd5ab1]
- Updated dependencies [57ba039]
- Updated dependencies [57ba039]
- Updated dependencies [57ba039]
- Updated dependencies [adf8cc1]
- Updated dependencies [98ab832]
- Updated dependencies [98ab832]
- Updated dependencies [98ab832]
  - @fnndsc/brasa@0.18.0
  - @fnndsc/cumin@3.19.0
  - @fnndsc/menu@0.5.0

## 0.10.1

### Patch Changes

- 53a736f: fix(calypso): a feed's topology walk is annunciated on a quiet daemon

  The heartbeat re-pushed the promptline only when the index counts moved or the previous push still showed warm-up. A feed's topology walk (a first visit, `proc refresh`) reports its progress into the prompt context page by page but adds its instances to the index only once the walk is done, so on a quiet daemon the counts stood still for the whole walk and the JOBS readout never named the feed — it was annunciated only when a background sweep happened to be moving the counts at the same time. The heartbeat now also pushes while a foreground command is executing, which is exactly when a walk can be in flight.

## 0.10.0

### Minor Changes

- a7f057c: feat: a value-taking flag given no value asks for it

  `pacs query … --csv-to` with nothing after it now means "ask me where". Before, such a flag was silently ignored: the operator asked for a table and got none, which is worse than either answering or refusing.

  No sigil was needed. `?` was the obvious spelling and is already a glob in `string_checkHasWildcard`, so it would have expanded against the VFS; a flag that takes a value and is given none is unambiguous on its own, and the rule now generalises to every flag in the stack without another convention.

  The ask carries what it wants — a `path`, with the session's own cwd as its anchor, a suggested basename, and `EXPORT HERE` as the word its committing control should read. The anchor is a fact rather than a guess: inventing a directory means creating one behind the operator's back. And it is raised only once there is something to write, since a question about a file that may never exist is asked too early.

  Two rules ride with it, both in the daemon, both about who may interrupt an operator:

  - **A command marked `instrument` may never ask.** A pane's silent refresh or an ambient cycler raising a question is refused outright — the operator did not issue that command and cannot answer for it.
  - **One question at a time per surface.** A second is refused by name rather than queued, because a queued question is one whose command the operator has forgotten issuing.

  An abandoned ask is not a failed query: the answer stands and only the writing does not happen.

  `prompt_current` now takes the whole request rather than a message and a flag, and the daemon relays `wants`, `path` and `commit` to the surface. `repl_confirm` and `repl_questionPath` join the kernel's ask helpers, so a caller states the kind once and every surface reads the same intent.

- 78d85ae: feat(argus): a location is asked for by borrowing a browser

  An ask is never a box. A `path` question opens the instrument that already shows that space: a **new** files pane beside the pane that asked — never an existing browser, since hijacking one loses the operator's place — anchored where the ask said, closing when the errand ends either way.

  Its controls ride a bar of its own across the top of the pane: the question as a caption, the composed path as an editable field, **MKDIR** for a folder that does not exist yet, and one verb that commits, reading the word the kernel sent (`EXPORT HERE`). The grill had put those on the mode frame; building it showed why they cannot live there — the frame is a narrow rail against the spine, right for a column of capsules and hopeless for a caption and a path, and it answers to what the _field_ holds, which an errand does not change.

  Three defects the live run turned up, each fixed here:

  - **The errand opened an empty browser, forever.** The daemon runs commands one at a time, so the listing that would answer the question queued behind the command that asked it: the answer waiting on the browsing, the browsing waiting on the answer. An instrument command now runs **beside** a command waiting on a question — the natural twin of the rule that an instrument may never ask. A pane's own read neither asks nor waits, and the daemon saves and restores the executing command rather than clearing it, so the outer command's output still finds its way home.
  - **The errand split beside the focused pane**, which can be one the current preset does not hold. A split beside a pane that is not in the tree fails silently, and an errand that never opens is a question asked of nobody. The host is now a leaf that is actually on stage.
  - **The anchor could be somewhere nothing can be written.** A session sitting in `/bin` or `/proc` is browsing a provider, not standing where a file lands, so the ask falls back to home rather than offering a destination that is refused the moment it is committed.

  Law `an-ask-borrows-an-instrument`, smoke-enforced. Two consecutive full smoke runs, 103 checks.

- 9e2a9dd: feat: a verb that acts on the place rides the frame — MKDIR and UPLOAD

  Two verbs act on the PLACE the field holds rather than on any row, so they ride the field's own frame beside HOME and BACK, and they appear on a browser's frame and nowhere else — there is no directory to make in a list of feeds.

  **MKDIR** asks for a name in the console and makes it where the field points, not where the session's cwd happens to be: a rooted browser is showing a place of its own, and a verb that acted on the session's place instead would make the folder somewhere the operator is not looking.

  **UPLOAD** is the verb this surface could not previously speak at all. `upload` reaches the daemon's disk, which a browser has never seen. So the operator's own picker chooses the file, and the bytes travel over the daemon's `/vfs` route — now answering `POST` as well as `GET` — where the **engine** writes them through the kernel. No surface talks to CUBE, the same attach token gates the write as gates the read, and the body is capped. The console keeps the account, because a gesture the surface performs itself still owes the transcript what it did.

  New seam: `Engine.file_write(path, bytes)`, the twin of `file_read`. It writes through salsa's own create and **invalidates the listing it changed**, as every writing builtin does — without that the browser asks for the folder again and is served the folder as it was before the delivery, which reads as an upload that silently did nothing.

### Patch Changes

- 3df1c41: docs(calypso): say calypso where the component is meant, and make it typeable

  Every other part of the stack is a noun with a role — cumin, salsa, chili, brasa, menu, chell, argus. The session supervisor was the odd one out, described by a flag on another program, so the prose said "the daemon" for something that already has a name, a package, a binary and a doctrine document.

  Host control is _calypso's_ policy; berths are calypso's; the wire is calypso's. "Grant calypso host access" says whose policy changed. "Grant the daemon" does not.

  Operator-facing text now names it: the flag help, the not-running message, the already-running refusal, the listening banner, the attach errors, the several-sessions chooser, and the host-control sentences — `upload` refusing without the `files` tier, the HOST banner, and argus's HOST lamp tooltip.

  The start hints used to read `chell --daemon <user>@<url>` while the prose said "run calypso". They now say `calypso <user>@<url>`, which is a real command, since calypso ships its own binary. The getting-started guide leads with what calypso _is_, then gives both ways to start it — standalone from a saved session, or through chell logging in fresh — because they genuinely differ and one does not replace the other.

  **Daemon survives where it is correct**: a mode name, an anchor, a make target, a background process. Code symbols are untouched — `daemon_launch` and its kin describe something that really is a daemon, and churning them buys nothing an operator sees. Command lines inside code blocks were left alone, so nothing became a command that does not exist.

- Updated dependencies [a7f057c]
- Updated dependencies [da15f3b]
- Updated dependencies [78d85ae]
- Updated dependencies [349d7d2]
- Updated dependencies [8312a79]
- Updated dependencies [02ef648]
- Updated dependencies [3df1c41]
- Updated dependencies [f5c16fe]
- Updated dependencies [116e8ba]
- Updated dependencies [ec3ef9f]
- Updated dependencies [6234d55]
- Updated dependencies [ba1e5b4]
- Updated dependencies [404f5e3]
- Updated dependencies [7181f7e]
- Updated dependencies [d2a4315]
- Updated dependencies [a245b5f]
- Updated dependencies [9e2a9dd]
- Updated dependencies [5a339f0]
- Updated dependencies [a8449bc]
- Updated dependencies [8446459]
- Updated dependencies [17964a9]
- Updated dependencies [62761a3]
- Updated dependencies [17964a9]
  - @fnndsc/brasa@0.17.0
  - @fnndsc/cumin@3.18.0
  - @fnndsc/menu@0.4.0

## 0.9.1

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

## 0.9.0

### Minor Changes

- 4f034b9: Host control: `chell --daemon --host-control[=shell,files,pipes]` lets the daemon declare capabilities of its own — `!` runs on the daemon host, pipe segments run there, `upload`/`download` reach its disk — off by default, refused on a non-loopback bind without `--expose-host-control`, and annunciated everywhere (attach ack `hostControl`, the daemon face, the prompt's HOST segment, a remote shell's banner). Without the `files` tier, `upload` under a daemon now refuses instead of reading the daemon host's disk.

### Patch Changes

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
- Updated dependencies [85c6813]
  - @fnndsc/cumin@3.17.0
  - @fnndsc/menu@0.3.0
  - @fnndsc/brasa@0.16.0

## 0.8.0

### Minor Changes

- 97af423: Watches: a surface can keep a running feed live. New wire pair `watch` / `unwatch` (subject = `/proc/jobs/feed_N`, owned per surface, released on detach) and a `watched` report (`live` | `settled` | `stale`). While anyone watches a feed the engine samples it on an adaptive cadence (3 s while it changes, backing off to 30 s when quiet), and whenever a visit changes the cache it publishes the refreshed `feed.dag` model to every surface as a session-bus envelope from the `daemon` surface, off the scrollback. A feed that settles reports `settled` and the watch ends; a failed sample reports `stale` and keeps trying. `proc watch <feed>` / `proc unwatch <feed>` are the console forms (`proc watch` lists). The engine gains an ambient event bus for events it originates on its own. Feed visits within one second of each other now share one sync, and `feedVisit_sync` reports whether it succeeded.

### Patch Changes

- Updated dependencies [920e0ac]
- Updated dependencies [7a0f06e]
- Updated dependencies [920e0ac]
- Updated dependencies [c716624]
- Updated dependencies [cece0dc]
- Updated dependencies [97af423]
  - @fnndsc/cumin@3.16.0
  - @fnndsc/brasa@0.15.0
  - @fnndsc/menu@0.2.0

## 0.7.1

### Patch Changes

- Updated dependencies [85791b3]
  - @fnndsc/brasa@0.14.0

## 0.7.0

### Minor Changes

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

- 790f994: Instrument traffic stays off the session bus.

  A surface's internal commands — a panel's silent listing refresh, an ambient
  cycler's pipeline renders — are not things the operator said, yet they were
  broadcast to sibling surfaces and retained in scrollback, so a second
  attached console printed them live and every reattach replayed them as
  noise. The execute message gains an optional `instrument` flag: the daemon
  runs the command normally but skips the bus publish and the scrollback
  entry, so siblings and replays carry only operator activity.

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

- 28b9a9f: Regard: the session learns what the operator is indicating.

  The wire contract gains one message, `regard`, travelling both directions
  under one shape: a surface reports the addressable thing the operator most
  recently indicated (a file clicked in a browser, a DAG node selected), and
  the daemon retains it as session truth — last write wins — mirrors it into
  the engine, and rebroadcasts it to every attached surface. A late attacher
  receives the retained value with its ack, so spawn-then-see workflows start
  seeing immediately.

  The value is an address in the namespace plus the model kind it was
  indicated through, never view-space coordinates: what has no address is view
  state and stays surface-side. The brasa session retains the value behind
  `regard_get`/`regard_set`, so engine-side consumers can answer "what is the
  operator regarding" without any surface geometry crossing the seam. Design
  record: apps/argus/docs/aegis.adoc.

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

- bf09355: The telemetry heartbeat now refreshes the promptline while the process index moves: warm-up progress reaches idle surfaces without waiting for a command, and the prompt settles when reconciliation completes.
- Updated dependencies [1d600ac]
- Updated dependencies [0adb4f2]
- Updated dependencies [31c2a50]
- Updated dependencies [1c195a7]
- Updated dependencies [9ed68cd]
- Updated dependencies [e58bf58]
- Updated dependencies [e062dbf]
- Updated dependencies [87f7c59]
- Updated dependencies [3125517]
- Updated dependencies [28b9a9f]
- Updated dependencies [8842ab4]
- Updated dependencies [b39b584]
  - @fnndsc/brasa@0.13.0
  - @fnndsc/cumin@3.15.0

## 0.6.1

### Patch Changes

- 07ae801: The daemon now finds the argus bundle relative to its own module location, not only the working directory. A dev-tree `chell --daemon` launched from anywhere serves the web surface; previously it silently served nothing unless the daemon was started from the checkout root or `CALYPSO_WEB_ROOT` was set by hand.

## 0.6.0

### Minor Changes

- 0ad04f2: The engine can now hand raw file bytes to a hosting daemon: brasa's `BrasaEngine` gains an optional `file_read(filePath)` that resolves a ChRIS VFS path to a `Buffer` through chili's binary cat. Calypso's daemon exposes it as a token-gated `/vfs?path=&token=` HTTP route with extension-derived content types, letting a web surface render images and other binary content that a text transcript cannot carry.
- 1928d4b: The daemon now rides an explicit HTTP server: WebSocket upgrades carry the session contract unchanged, and plain GETs serve a configured static web root (the built ARGUS surface), discovered from `CALYPSO_WEB_ROOT` or a monorepo checkout's `apps/argus/dist`. The launcher prints the browser URL with the attach token. A new `@fnndsc/calypso/protocol` subpath exports the browser-safe wire contract (schemas, validation, version) without server-side dependencies.

### Patch Changes

- Updated dependencies [0ad04f2]
  - @fnndsc/brasa@0.12.0

## 0.5.1

### Patch Changes

- Updated dependencies [14f8ee8]
- Updated dependencies [69b0617]
- Updated dependencies [7ed8e1c]
- Updated dependencies [7dc3bca]
  - @fnndsc/cumin@3.11.0
  - @fnndsc/brasa@0.11.0

## 0.5.0

### Minor Changes

- 67377a3: Unify the five correlation-id request/reply implementations onto one `RequestBroker`. The daemon's four surface-delegated brokers (prompt, pipeline segment, host shell, edit) and the remote client's own pending-request map previously each reimplemented the id/pending/close lifecycle with divergent correctness; all five now share one class that uniformly guarantees origin-validated settles (no surface can answer another surface's prompt), close-listener removal on settle (no per-request listener leak), and rejection when the origin disconnects. The protocol gains optional `promptError` and `editError` messages (additive, no version bump) so a surface can report a failed or impossible prompt or edit. Behavior change on the remote surface: a client without a prompt, pipe, or edit handler now reports the inability as an error instead of silently answering empty, passing pipe input through unchanged, or returning an unchanged "successful" edit.
- b2f5ad3: Greet every surface with the stack's identity. Builds now record the short git hash they were produced from (`dist/buildinfo.json`, written by the new `scripts/buildinfo.mjs` build step), and brasa exposes it through `buildHash_get` alongside `welcomeLine_build`/`welcomeLine_compose`, which render a banner of the form `ChELL Executes Layered Logic, v 5.3.0 (886f09). Welcome.` An interactive chell session prints the banner and a short fortune at boot, the calypso daemon announces its banner plus an aligned version line for every stack layer (chell, brasa, chili, salsa, cumin, calypso) when it starts listening, and the attach handshake gains an optional `stack` field carrying all six versions and the build hash, so a remote surface banners the daemon's full reported stack rather than its local install's. `fortune_random` is exported for reuse, with an optional line-count bound so banners favour short cookies.

### Patch Changes

- 8ec8a4b: Add explicit, command-scoped CUBE elevation with `sudo <command>`. The active surface collects an administrator identity and hidden password; a temporary CUBE client runs only the nested command, then the normal session is restored. Group membership and plugin registration now suggest a copyable `sudo` rerun after an authorization failure, and plugin registration no longer owns a separate interactive admin prompt.
- d0ac04f: Preserve failure causes and tighten cache contracts. Errors that were replaced by generic messages now carry their real cause: controller and handler creation failures name the underlying error instead of "no ChRIS context", `cat` shows the actual fetch failure, docker command failures surface stderr detail, context-set errors actually print, settings load/save failures are announced instead of silently using defaults or losing changes, unreadable berth and discovery files are named instead of reading as "no daemon", token-file read errors are distinguished from the logged-out state, and resource deletes report why they failed. Every remaining deliberate error absorption now carries a dated adjudication comment. Cache contracts: the PACS provider's decoded-query cache caches settled results only and is size-bounded; the object-context factory gains an eviction hook (`objContext_evict`) for deleted plugin or feed ids; `mv` and `cp` invalidate the whole affected listing subtree; and a new PACS query invalidates the cached `/net/pacs/queries` listing so it appears in the next `ls` immediately.
- 3cde784: Publish refreshed prompt context before completing a remote command so
  state-changing commands cannot leave ChELL displaying a stale prompt.
- ac69b3e: Run ChELL shell escapes on the originating surface, including remote clients,
  instead of exposing the CALYPSO daemon host process and filesystem.
- Updated dependencies [2e60785]
- Updated dependencies [66bc932]
- Updated dependencies [8ec8a4b]
- Updated dependencies [d0ac04f]
- Updated dependencies [886f09c]
- Updated dependencies [50e9bb1]
- Updated dependencies [d0ac04f]
- Updated dependencies [22db63f]
- Updated dependencies [ac69b3e]
- Updated dependencies [0e92d4d]
- Updated dependencies [590a943]
- Updated dependencies [fa81126]
- Updated dependencies [b2f5ad3]
  - @fnndsc/brasa@0.10.0
  - @fnndsc/cumin@3.9.0

## 0.4.5

### Patch Changes

- Carry semantic Pipeline-inspection progress from a hosted Brasa engine to
  the remote surface that issued the command.
- Updated dependencies
  - @fnndsc/brasa@0.9.8

## 0.4.4

### Patch Changes

- Carry cold, cached-refresh, and failed `/proc` lifecycle state through the
  CALYPSO prompt contract; reorder p10k segments and render distinct lifecycle
  clues for local and remote surfaces.
- Updated dependencies
  - @fnndsc/cumin@3.8.2
  - @fnndsc/brasa@0.9.3

## 0.4.3

### Patch Changes

- 6f0833a: Release the coordinated ChELL stack with deterministic `/proc` topology progress, complete visible-feed indexing, safe warm-up query gating, remote one-shot command completion, and refreshed daemon documentation.
- Updated dependencies [6f0833a]
  - @fnndsc/cumin@3.8.1
  - @fnndsc/brasa@0.9.2

## 0.4.2

### Patch Changes

- 71a6cd4: Route a pipeline executable's bare `--signalflow` flag to SignalFlow diagram output and provide contextual help for dynamic pipeline commands. Keep final-segment redirection on the originating surface, propagate remote pipe-segment failures back to the engine, and prevent remote command errors from terminating the interactive ChELL client. Daemon mode now reports shared startup cache warming and publishes its listening berth only after engine readiness. Consistently document `signalflow -` for stdin rendering.
- Updated dependencies [71a6cd4]
  - @fnndsc/brasa@0.9.1

## 0.4.1

### Patch Changes

- Updated dependencies [e630f79]
- Updated dependencies [e630f79]
  - @fnndsc/brasa@0.9.0
  - @fnndsc/cumin@3.8.0

## 0.4.0

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

## 0.3.7

### Patch Changes

- Updated dependencies [8ac7ef9]
  - @fnndsc/brasa@0.8.0

## 0.3.6

### Patch Changes

- Updated dependencies [a1f6694]
- Updated dependencies [01ab743]
- Updated dependencies [b8ae635]
- Updated dependencies [ca63e8b]
  - @fnndsc/cumin@3.7.0
  - @fnndsc/brasa@0.7.0

## 0.3.5

### Patch Changes

- Updated dependencies [e5a30f7]
  - @fnndsc/brasa@0.6.0

## 0.3.4

### Patch Changes

- Updated dependencies [c2087d0]
  - @fnndsc/brasa@0.5.0

## 0.3.3

### Patch Changes

- Updated dependencies [512e14f]
- Updated dependencies [880d37a]
- Updated dependencies [e43f42a]
  - @fnndsc/brasa@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies [a0d3df5]
  - @fnndsc/brasa@0.3.0

## 0.3.1

### Patch Changes

- Updated dependencies [d69b086]
  - @fnndsc/brasa@0.2.0

## 0.3.0

### Minor Changes

- c824000: calypso is now a self-contained session daemon. It gains the `calypso` binary (create a brasa engine, restore a saved session, host it over WebSocket) and depends on the new `@fnndsc/brasa` engine package.

  Breaking (allowed under 0.x): the package is now ESM-only (was CommonJS), and the `promptline` wire message carries a prompt `context` for the surface to theme, rather than a pre-rendered `text` string.

## 0.2.0

### Minor Changes

- f8e0233: Add the CALYPSO daemon: a WebSocket host over one engine. `CalypsoDaemon` binds the loopback interface only and hosts a single engine, which it accepts through a structural `HostedEngine` interface (chell's `ChellEngine` satisfies it) rather than importing chell — keeping calypso engine-agnostic and free of a package cycle. A surface attaches with the contract version and a random attach token (generated at startup, written to a user-readable 0600 file for same-user discovery, compared in constant time via `timingSafeEqual`); once attached it drives the engine with `execute` and `complete` messages and receives `result` and completion replies, with execution serialized per connection. CUBE credentials never cross the wire — the hosted engine holds its own session. This slice returns each command's final result envelopes; live output streaming and the cross-surface session bus build on it.
- 30a3e1e: Interactivity over the wire: a builtin that prompts during a remote command now reaches the surface running it. The contract gains a `prompt` request (daemon→surface, with hidden-input support) and a `promptAnswer` reply (surface→daemon). The daemon serializes execution across the whole session so a mid-command prompt has one unambiguous target, and exposes an input broker (`prompt_current`) the host wires into its `Surface`; the `chell --daemon` launcher installs a surface whose `prompt` delegates to it, so `repl_question` (passwords, confirmations, the plugin admin flow, the prompt configurator) works over the wire unchanged. The `chell --remote` client answers incoming prompt requests from its own terminal (hidden when asked) and replies. Completion already round-trips from the earlier daemon work; the themed pushed prompt string and client-side pipe-segment execution remain follow-ups.
- 93e604f: Run pipeline segments on the surface, never on the daemon host. Segment execution becomes a surface capability: the `Surface` gains `pipeSegments` (a capability flag) and a `pipeSegment(command, input)` method. The local CLI runs segments in-process exactly as before (byte-identical); the daemon's surface routes them over the wire (new `pipe`/`pipeResult` messages, base64 for the bytes) to the surface running the command, which runs them on its own machine — so a pipeline like `ls | grep foo` never spawns anything on the daemon host, closing that attack surface. A surface without the capability (a browser) fails such pipelines with a clear message. Completes the interactivity work: prompts, completion, the pushed prompt string, and pipe segments all now work over the wire.
- f492dd9: Push the themed prompt string to remote surfaces. Only the daemon holds the session context the prompt renders, so it renders the prompt and pushes it (a new `promptline` message) to every surface on attach and after each command — the context may have changed. A surface prints what it receives, so prompt themes look identical whether the session is local or remote. chell factors prompt rendering into a shared `sessionPrompt_render` used by both the local REPL and the daemon's `promptProvider`; the `chell --remote` client renders the latest pushed prompt (falling back to a fixed string until the first push), replacing the placeholder prompt it showed before.
- 7cee888: The surface owns the local editor, so `edit` works over the wire. The `Surface` gains a `localEdit(content, extension)` method (resolving the flag-only deferral from the prompt-capability work): the CLI surface backs it with the temp-file-and-`$EDITOR` mechanics that used to live in the `edit` builtin, and the daemon backs it by routing to the surface running the command (new `edit`/`editResult` messages + an `edit_current` broker) so the operator's own editor opens, never one on the daemon host. The `edit` builtin no longer touches processes or temp files for editing — it fetches the file, hands the content to `surface.localEdit`, and uploads the result; `chell --remote` opens the client's editor. A surface without the `localEdit` capability (a browser) fails `edit` with a clear message.
- e293d97: Add the session bus to the daemon. All attached surfaces share one session: each command's result envelopes are broadcast to the _other_ attached surfaces as `session {surface, envelope}` events (tagged with the surface that produced them), so a command issued in one surface is immediately visible in the rest — the originator receives its own correlated `result`, not a duplicate broadcast. A bounded scrollback ring buffer (default 200 envelopes, configurable via `scrollbackSize`) is replayed to an attaching surface so it does not join blind; scrollback is presentation rather than truth, so a daemon restart correctly loses it. Surfaces are dropped from the bus when their socket closes.
- 38df08f: Introduce `@fnndsc/calypso`, the fifth mise package: the session daemon that will host the chell engine and serve it to surfaces over a WebSocket. This first slice is the wire contract — the typed protocol schemas and boundary validation every message crosses. Messages are two direction-keyed discriminated unions (surface→daemon: attach/execute/complete; daemon→surface: attached/result/complete/output/session/error), defined as zod schemas that are the single source of truth and from which the message types are inferred. A `commandEnvelopeSchema` validates cumin's `CommandEnvelope` on the wire, kept in step with cumin's type by a compile-time guard so the contract cannot silently drift. Boundary validation rejects structural violations, tolerates unknown additive fields, and never throws; the contract version is carried in the attach handshake and refused on mismatch. See docs/calypso.adoc for the governing design.

### Patch Changes

- Updated dependencies [aa81b0a]
- Updated dependencies [2099ff6]
- Updated dependencies [c47ff22]
  - @fnndsc/cumin@3.5.0
