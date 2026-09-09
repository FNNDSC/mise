# @fnndsc/brasa

## 0.19.0

### Minor Changes

- 49634f2: feat(brasa): the index snapshot the daemon heartbeats carries CUBE's pace
- 2545ffa: feat(brasa): the index snapshot carries the lab's pulse — jobs running and waiting, and the feeds that errored — derived from the roster's counters

### Patch Changes

- Updated dependencies [49634f2]
- Updated dependencies [49634f2]
- Updated dependencies [2545ffa]
  - @fnndsc/cumin@3.20.0
  - @fnndsc/menu@0.6.0

## 0.18.0

### Minor Changes

- 6cd5ab1: feat(brasa): `feed diagram`, `feed tree`, wire `feed.dag` and `proc refresh <feed>` answer at once with `feed.indexing` when the feed is cold; a feed watch holds the floor while its topology is indexing, never settles on an empty topology, and is kicked by the cache the moment the walk lands
- 57ba039: feat(brasa): the prompt context names every feed walk in flight, not only the earliest
- 98ab832: feat(brasa): `proc feeds` and `proc jobs list` answer from the cache at once and start the roster sync off the session's lane; the prompt context names the walk while it runs

### Patch Changes

- Updated dependencies [6cd5ab1]
- Updated dependencies [6cd5ab1]
- Updated dependencies [6cd5ab1]
- Updated dependencies [57ba039]
- Updated dependencies [57ba039]
- Updated dependencies [57ba039]
- Updated dependencies [adf8cc1]
- Updated dependencies [adf8cc1]
- Updated dependencies [98ab832]
- Updated dependencies [98ab832]
- Updated dependencies [98ab832]
  - @fnndsc/cumin@3.19.0
  - @fnndsc/menu@0.5.0
  - @fnndsc/salsa@3.14.0

## 0.17.0

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

- da15f3b: feat(argus): the surface can be asked

  argus refused every question the session put to it — `the argus surface cannot answer prompts`, with `hiddenInput: false` as the stated reason. So `sudo` dead-ended in the web surface, a confirmation dead-ended, and no control could ask for a value the operator had not already typed.

  It answers now, in the **console**: where the session speaks, and where the scrollback keeps what was asked, so an operator can look back at the question as well as the answer.

  - **`text`** takes an inline line.
  - **`secret`** masks the field and enters the transcript as dots — never its text, never its length — which is what lets `hiddenInput: true` be declared honestly.
  - **`confirm`** puts YES and NO capsules beside the question, because a control that reads as what it does beats a letter an operator has to know to type. Typing `y` still works for a hand already on the keys.
  - **`path`** is answered here too for now, with its suggestion offered so answering is a rename rather than a whole path typed out. The errand that walks a browser for it is the next slice; until then a location is answerable rather than refused.

  A question outranks the command line while it is open: an answer is never dispatched as a line, and a queued line never jumps ahead of it. **Esc abandons**, which is an answer of its own — the command is told, and reports what it did not do.

  Two asks that never travelled were routed through the surface while here. `rm -i` built its own readline against `process.stdin`, so under a daemon its confirmation was put to whoever started the daemon rather than to the operator who typed the command — they would have waited forever for a question asked of somebody else's terminal. `upload`'s confirmation was untyped, and is now a yes/no like the download's.

  Verified live: `sudo` in argus asks for an administrator username, masks the password, leaks nothing to the transcript, and abandons cleanly. Law `a-question-is-answered-where-the-session-speaks`, smoke-enforced.

- 349d7d2: feat: a missing destination is asked for, not refused with a usage line

  `mv foo` names what to move and never says where. Until now that was a usage line — telling an operator the shape of a command they had just typed correctly enough to be understood, instead of asking them the one thing they had not said. A required operand with no value is the same sentence as a value-taking flag with no value, and now gets the same answer: `mv` and `cp` ask.

  The ask is the typed `path` ask that already exists, so neither verb knows which surface it is talking to: a terminal renders it as a line, and a surface that browses borrows a files pane for it. It opens where the source already lives, wants a directory when there is more than one source, and its committing control reads `MOVE HERE` or `COPY HERE`.

  It offers no default name. The only name `mv` could propose is the source's own, and the first live run took Enter as exactly that and moved a file onto itself. The rule that came out of it holds for every path ask, and the terminal now implements it directly: the **anchor** says where to look, the **suggestion** says what to offer, and a verb with nothing to offer offers nothing — Enter on such a question answers nothing rather than answering with the question.

  An abandoned ask moves nothing and says so (`mv: no destination given; nothing moved.`), rather than failing with a description of `mv`.

- 02ef648: feat: a write is checked before it happens, and says what it did

  A chooser can hand a write a place that cannot be used, so `--csv-to` stopped trusting the path it is given:

  - **A provider path is refused by name.** `/net/pacs/x.csv` is somewhere to browse, not somewhere a file lands, and CUBE's own refusal talks about an upload, which says nothing about why.
  - **A missing folder is made, and said** — a directory appearing without a word is the silent side effect this replaces. argus's EXPORT CSV no longer runs `mkdir ~/audits` behind the operator's back; it lowers to `--csv-to` with no value, so the destination is asked for.
  - **An existing table is never overwritten in silence.** It takes `--force`, and the replacement is reported.
  - **The pane states the path** the kernel reported writing, rather than leaving it to the console alone.

  Three things the live run turned up that no mock would have shown:

  - **`files_listAll` answers null for an empty folder AND for one that is not there**, so existence can never be inferred from it. Doing so reported a folder "made" that already existed, and a file "already there" in a folder that did not exist at all. Existence is asked of `files_path_isDirectory` now.
  - **CUBE answers a re-upload over a path it already holds with a 500, thrown.** An unhandled throw in a builtin does not stop at the command: under a daemon it takes the process, and every surface attached to it. The write is wrapped — a store's bad day is a refusal, not an outage.
  - **Deletion is asynchronous**, so removing a file and writing in the same breath races the store and answers 500 again — with the operator's old file already gone. `--force` now removes, waits for the path to stop resolving, writes, and confirms by listing afterwards, because a write reported without confirmation was seen to leave nothing behind.

  Both CUBE behaviours are recorded in `docs/CUBE-gaps.adoc`, with what the API could offer instead.

- 116e8ba: feat(listing): progress is a trait of a row, and a row can carry verbs

  The operator's observation: progress is not a PACS quirk. A feed row should say how far its work has got without anyone opening it, and every level should report — a series its own pull, a study the sum of its series, a patient the sum of its studies.

  **The wire could not say it.** The `feed.list` model carried id, title, owner, status, created and two totals that need resident topology, so a roster genuinely could not know a feed's progress. CUBE's own job counters were already on the process cache, so the kernel now derives `jobsDone` and `jobsTotal` from them — settled meaning finished, errored or cancelled — and they travel with the feed row rather than waiting for topology. Kernel, wire, surface, in that order.

  **Progress aggregates by addition, not by average.** A study's progress is the sum of its series'. An average would let one finished series of a hundred files outweigh a stalled one of ten thousand.

  **A row with nothing scheduled still gets a track**, dimmed. The absence of a bar reads as "no such thing"; a dim track reads as "nothing has happened yet", which is the truth and the more useful statement.

  **Actions are not traits.** A trait says what a row is under some column; an action is a verb applied to it, and it sits outside the column grid because it answers to no cap. Capsules stop click propagation, so pressing one is not also activating the row.

  **Expansion has two modes**, declared rather than assumed: `replace` leaves the parent behind, `fold` keeps it on stage with the child inside. PACS exercises both in the next slice.

  The runs roster gains NODES and PROGRESS, which widened its positional track list from seven columns to nine.

  One smoke assertion changed, and deliberately: it counted seven cells per row as a literal. It now counts cells against the number of caps, which is the invariant that actually protects a positional grid and needs no edit when a column is added.

- ba1e5b4: feat: a PACS answer can be written as a table a spreadsheet reads

  `--csv` renders the answer; `--csv-to <cfs-path>` writes it into ChRIS storage; argus's EXPORT CSV lowers visibly to the second, as GATHER's SAVE already lowers, so the operator reads the command that ran.

  Two flags rather than one with an optional value: `--csv PatientID:1234` cannot tell a destination from a query expression, and guessing wrong writes a file named after a patient.

  **Why a CFS destination exists.** A local terminal needs none — `--csv > audit.csv` writes the operator's own disk, because engine and operator share a filesystem. A detached surface does not: the engine runs on the daemon's host, so a redirect lands on somebody else's machine (#415, where `>` also turns out to bypass the `engineFilesystem` capability built to prevent exactly that). A cohort's MRNs and study descriptions stay inside ChRIS, and the file browser or `download` retrieves them.

  **The table's shape carries the level above's doctrine**: a row per study, and a row for every patient that owns none. A table built from studies alone would silently drop the misses, which are what an audit is usually asking about. `ANSWERED` carries an ISO timestamp rather than `3 MONTHS AGO` — a spreadsheet sorts dates; a phrase is for a human glance.

  Every cell is quoted and embedded quotes doubled, the rule chili's `--csv` has always followed, now stated as a function rather than left inside a handler nothing else can call — so a study description like `MRI BRAIN, W/ AND W/O "GAD"` survives the trip.

- 404f5e3: feat: a PACS question that names several patients becomes several questions

  A PACS will not match a list. `PatientID:4356325\4433255` — the DICOM multi-value form — returns nothing from a real PACS, and the standard agrees: _List of UID Matching_ is defined only for attributes whose VR is `UI`, and `PatientID` is `LO`. So asking after two hundred MRNs is two hundred C-FINDs, and the fan-out is forced rather than chosen.

  **The inline comma list is the operator's own syntax, now accepted.** `query PatientID:1234,4532,6654` is three questions and one table; `query PatientID:1234,StudyDate:20240101` still means what it always meant. There is nothing to disambiguate — every genuine term carries a colon, so a bare segment can only be another value for the key before it. Several multi-valued keys fan out over their cross-product, and above 32 the command refuses by name rather than launching hundreds at a shared clinical system.

  **`--patients <list|@file>` carries a real cohort.** `@file` names a file in ChRIS storage, read through the session's own path and never the engine's host disk, so the flag behaves identically from a local shell, a remote shell and a browser — and a list on somebody's laptop reaches it through `upload`, the gated door. One MRN per line; blanks and `#` comments ignored.

  **Four questions in flight**, in one constant. Not operator-settable: nobody inside mise knows the right number for a given hospital, and a flag that can hurt a shared clinical system will eventually be set to 50.

  **A failure is not a miss.** A question that could not be asked is recorded `unasked` with its reason, never as zero studies. A server that timed out has told us nothing; a PACS that answered with nothing has told us something, and a clinician acts on the difference. The table says `FOUND 2 · NONE 1 · UNASKED 0`, and the model carries every row.

  **Replay applies per patient**, so a cohort's already-asked MRNs never leave the building — verified live against rows answered eight months ago.

  Two things found live while proving it:

  - **CUBE refuses a second PACSQuery with a title it already holds for that server.** A fan-out under one title had every question after the first come back `You have already registered a PACS query with title=…`, which a less careful client would have rendered as "no imaging". Each question now carries its own title. Recorded in `docs/CUBE-gaps.adoc`.
  - **`chell -c` and `chell -f` had no replay at all.** A one-shot skips the boot warm-up — correct — but that left the replay index neither restored nor written, so a scripted cohort re-asked the PACS every single time, and the audit workflow the fan-out exists for was the one workflow replay never reached. A one-shot now primes the index from the checkpoint a previous run paid for, and flushes what it learned before exiting, since the debounced writer's timer never fires in a process that short.

- 7181f7e: feat: a PACS question can be put to several servers at once

  `--pacsserver a,b` asks each named server and unions the answers into one listing. It is the same fan-out a cohort uses, discriminated by a different column: SERVER rides every study and every patient row, so two answers can be told apart, sorted and filtered.

  **A row names its server only when more than one could have answered.** On a single-server query the column would repeat one value down the page and tell an operator nothing.

  **There is no sweep-everything.** The CUBE this was designed against carries thirteen registered servers, several reading as one-off or per-person registrations; an `--all` would mean thousands of C-FINDs mostly into endpoints of unknown liveness. A fan-out is always something the operator named.

  **A server that could not be reached is `unasked`, not empty.** Verified live: naming a server that does not resolve leaves that row `—` with its reason while the server that did answer still reports what it found. A server that could not be reached has told us nothing about that patient; rendering it as a zero would say the opposite.

  The reason on such a row is stripped of the error stack's debugging prefix where it becomes model data, since it is read in a terminal table and on a graphical surface alike.

  Servers are keyed by their canonical identifier — what CUBE files a query under, and therefore what the replay index matches on, so a question already asked of one server replays while the same question to another is asked fresh.

- a245b5f: feat: choosing which PACS to ask is a strip you pick from, never a sweep

  SERVER became a column of the study listing, and the law that places a form's fields put its control there with no separate decision to make: the cell stands in SERVER's column, wearing the form's own label.

  It is a **state readout you press** — `PACSDCM`, `PACSDCM +2` — that unfolds a strip of segments beneath the form, one per registered server, lit when included; the field's touch or Esc retracts it, the same retraction grammar the mode frames already use. Not a dropdown: LCARS has no popup layer and should not grow one, since a floating menu is exactly the window chrome this grammar rejects — and a strip of the pane's own width carries thirteen servers where a grid track could not carry three.

  **There is no ALL, and there will not be one.** Thirteen registrations of unknown liveness would mean thousands of C-FINDs mostly into the void. A fan-out is always something the operator named.

  **One chosen is a context; several is a query.** One lowers to a visible `pacs connect`, so the session moves and the linked terminal's prompt follows. Several lowers to `--pacsserver a,b` in the editable line and moves nothing. The prompt changing, or not, is the honest tell.

  **The list comes from the kernel, not from CUBE.** `pacs list` now carries a `pacs.servers` model beside the text it always printed — id, identifier, and which one the session is on. A surface asking CUBE itself would be reading a different CUBE from the one its commands run against. Liveness is deliberately absent: CUBE registers servers, it does not test them, and a field that looked like health would be a claim nobody checked.

  Two things found live: the PACS pane's own commands had no way back to it — the DAG pane's already did — so `pacs list` answered into the void; and the document's retraction listener closed the strip with the very press that opened it.

  Law `a-server-is-named-never-swept`, smoke-enforced.

- 9e2a9dd: feat: a verb that acts on the place rides the frame — MKDIR and UPLOAD

  Two verbs act on the PLACE the field holds rather than on any row, so they ride the field's own frame beside HOME and BACK, and they appear on a browser's frame and nowhere else — there is no directory to make in a list of feeds.

  **MKDIR** asks for a name in the console and makes it where the field points, not where the session's cwd happens to be: a rooted browser is showing a place of its own, and a verb that acted on the session's place instead would make the folder somewhere the operator is not looking.

  **UPLOAD** is the verb this surface could not previously speak at all. `upload` reaches the daemon's disk, which a browser has never seen. So the operator's own picker chooses the file, and the bytes travel over the daemon's `/vfs` route — now answering `POST` as well as `GET` — where the **engine** writes them through the kernel. No surface talks to CUBE, the same attach token gates the write as gates the read, and the body is capped. The console keeps the account, because a gesture the surface performs itself still owes the transcript what it did.

  New seam: `Engine.file_write(path, bytes)`, the twin of `file_read`. It writes through salsa's own create and **invalidates the listing it changed**, as every writing builtin does — without that the browser asks for the folder again and is served the folder as it was before the delivery, which reads as an upload that silently did nothing.

- 5a339f0: feat: a plugin is data — the manual becomes a projection of the model

  A plugin's substance existed only as text. `cat /bin/<entry>` fetched the plugin, formatted a manual, and that manual was the whole of what any surface could have — a paragraph nothing downstream can act on: not a card, not a parameter list, not a form, not an export.

  The kernel now builds the model first and renders the manual from it. `plugin info pl-dcm2niix-v2.0.0` answers with a `plugin.info` model carrying identity, the authoring facts, and every declared parameter; `cat /bin/pl-dcm2niix-v2.0.0` prints exactly the text it printed before, now as one projection of that model rather than a second independent scrape that can drift from it.

  **Parameters carry the flag as it is typed.** A plugin's own `flag` when it declares one, `--name` otherwise — a form built from the name alone would spell `--inputFile` where the plugin wants `-i`.

  **The parameter list is drained to exhaustion.** `getPluginParameters({ limit: 100 })` was one of the silent truncations catalogued in #401: a plugin declaring more lost the tail and said nothing about it. `pluginParameters_drain` walks to the end, and a live exemplar checks the model's count against the count CUBE itself reports — a client that both fetches and counts can agree with itself while being wrong.

  cumin gains `plugin_find` and `pluginParameters_drain` on the typed contract, so the `/bin` reader no longer reaches past it to the raw client.

  No surface change: this is the wire fact a plugin's one-node graph will read.

- a8449bc: feat: the roster shares, and a feed can be removed

  `setfacl` grants to an identity and applies to a feed, so the feed roster is where sharing belongs — a browser row offers SHARE only because the path it holds names a feed.

  The roster's rows learn the split the browser's already have: a click indicates, a double-click enters, and the action track is reserved on every row so a roster with verbs does not jump when one row starts speaking.

  - **SHARE** asks who, and the question itself says a grant cannot be taken back. The irreversibility is stated where the grant is made rather than discovered afterwards, and because the sentence lives in the kernel's ask, every surface says it.
  - Beside the verb, the row **reads back who already holds it** — a readout, not a verb: it says what the grant would be adding to.
  - **DELETE** lowers to `feed rm`, which is new: the kernel could delete a feed but no shell verb could. It asks first by default, naming the feed and what goes with it, and takes `-f` for a caller that has already asked its own question.

  `feed rm [<feed>] [-f]` joins the feed subcommands.

- 8446459: feat: a row is indicated before it is acted on

  The browser's rows have their verbs. Two problems had to be solved before they could:

  **There was no indicate gesture.** A click entered a directory, opened a file, opened a `/bin` entry — nothing meant "this one" without also meaning "go". A click now indicates and a double-click activates: the split the DAG scene already teaches, and what every file manager does. Only a listing that hides its verbs learns it — a browser given no verbs (a node's overlay) keeps its single click, since asking for a second click while offering nothing for the first is a worse bargain than the one it replaced.

  **A row that grew when indicated would make the listing jump.** The action track is reserved on every row at the capsule's own height, declared once and read by the track and the capsules alike, so what changes when a row speaks is what the track holds and never the geometry around it.

  Each verb lowers to a command the operator can read in the transcript:

  - **DELETE** → `rm -i` (`rm -ri` for a directory), so the kernel raises the confirmation and one confirmation grammar serves every surface.
  - **MOVE** / **COPY** → a one-operand `mv` / `cp`, whose missing destination is the ask that opens the errand.
  - **DOWNLOAD** → the file, as before.
  - **SHARE FEED n** → on any row whose path holds a feed, naming the feed because CUBE grants a feed and never a file, with the grants that already exist read out beside it.

  A `/bin` row is offered nothing: an executable the catalogue lists is not a file in a store.

  `setfacl <feed>` with no entry now **asks who to share it with**. A path and no entry names what to share and not with whom, which is a question rather than a usage error — the same law that made `mv foo` ask. Abandoning it shares nothing and says so.

- 17964a9: feat: SELECT is a mode, and a selection has verbs

  A mode describes how the field behaves, and this one changes what a click means. While SELECT is on a click gathers a row instead of indicating it, row verbs stand down — a row is not indicated then, it is selected — and the bar reads `SELECT · 2 SELECTED`, adding `· 1 SHOWN` when a filter hides some of what was gathered, since a verb acts on the selection and not on what is on screen.

  The selection belongs to the **field**: it survives a filter (which is how a selection gets built in a folder of hundreds) and the same rows arriving again; it is cleared by navigation, because a selection that follows the operator elsewhere is one they can act on without seeing; and leaving the mode clears nothing. Esc leaves SELECT before it retreats anywhere — but never while a question is open, since abandoning a question is an answer and one press must not answer two things.

  Its verbs ride the frame, and each is ONE command the operator could have typed:

  - `rm -rI "a" "b"` — **new `-I`**: one question for the whole list, naming how many, rather than one per file. A refusal removes nothing at all; there is no half of a set.
  - `mv -t` / `cp -t` — **new `-t <dir>`**: names a target directory so every operand is a source, and given no value it asks, wanting a directory.
  - `setfacl` over the **distinct feeds** the selection touches, which asks who once for the set.

  ## A defect this bought, and the guard for it

  The live run found the surface lowering a two-file selection to `mv a b` — which the shell correctly reads as "rename a onto b", and which moved one file of the pair onto the other. Chasing it turned up something worse and older: **a move onto a path the store already holds leaves a row CUBE's own API cannot serve, and one such row makes every listing of that folder fail** — the poisoning first seen in #462, now reproducible in three commands.

  `mv` refuses that move by name instead of attempting it, which costs one listing call and keeps the folder readable, and a failed move now reports the reason the kernel gave rather than a bare "Failed to move".

  Also: a browser re-lists after a verb that changed the folder it is showing (`fs.rm`, `fs.mv`, `fs.cp`) — `rm` reports what it removed, not where it removed it from, and a listing that keeps showing rows that are gone is a listing lying about the store.

### Patch Changes

- 78d85ae: feat(argus): a location is asked for by borrowing a browser

  An ask is never a box. A `path` question opens the instrument that already shows that space: a **new** files pane beside the pane that asked — never an existing browser, since hijacking one loses the operator's place — anchored where the ask said, closing when the errand ends either way.

  Its controls ride a bar of its own across the top of the pane: the question as a caption, the composed path as an editable field, **MKDIR** for a folder that does not exist yet, and one verb that commits, reading the word the kernel sent (`EXPORT HERE`). The grill had put those on the mode frame; building it showed why they cannot live there — the frame is a narrow rail against the spine, right for a column of capsules and hopeless for a caption and a path, and it answers to what the _field_ holds, which an errand does not change.

  Three defects the live run turned up, each fixed here:

  - **The errand opened an empty browser, forever.** The daemon runs commands one at a time, so the listing that would answer the question queued behind the command that asked it: the answer waiting on the browsing, the browsing waiting on the answer. An instrument command now runs **beside** a command waiting on a question — the natural twin of the rule that an instrument may never ask. A pane's own read neither asks nor waits, and the daemon saves and restores the executing command rather than clearing it, so the outer command's output still finds its way home.
  - **The errand split beside the focused pane**, which can be one the current preset does not hold. A split beside a pane that is not in the tree fails silently, and an errand that never opens is a question asked of nobody. The host is now a leaf that is actually on stage.
  - **The anchor could be somewhere nothing can be written.** A session sitting in `/bin` or `/proc` is browsing a provider, not standing where a file lands, so the ask falls back to home rather than offering a destination that is refused the moment it is committed.

  Law `an-ask-borrows-an-instrument`, smoke-enforced. Two consecutive full smoke runs, 103 checks.

- 8312a79: feat(chell): a terminal answers the same typed question

  A terminal has one instrument — a line — so a location ask cannot borrow a browser the way a graphical surface does. It renders into the line instead: the composed default in brackets, and Enter takes the offer.

  ```
  Where should the table go? [/home/rudolphpienaar/pacs-2026-09-07.csv]
  ```

  The answer a terminal commits is then the same answer an errand would have committed, without either surface knowing the other exists — which is the point of putting the _kind_ on the wire rather than a rendering. A yes/no says which letters it takes and offers no default, because there is no safe guess. A prompt from a daemon that predates typed asks reads exactly as it always did.

  Exemplar 12 closes the epic by driving the whole path through the kernel with a scripted surface: a value-taking flag given no value asks and the question says what it wants; the answer is what happens next and the file lands where it said; abandoning writes nothing and the command says so; and a session sitting in a provider path is not offered as a destination.

  It caught the epic's last defect: **an abandoned ask was throwing the answer away with the writing.** The model crosses either way now — the operator waited for that answer, and only the writing of it did not happen.

- 3df1c41: docs(calypso): say calypso where the component is meant, and make it typeable

  Every other part of the stack is a noun with a role — cumin, salsa, chili, brasa, menu, chell, argus. The session supervisor was the odd one out, described by a flag on another program, so the prose said "the daemon" for something that already has a name, a package, a binary and a doctrine document.

  Host control is _calypso's_ policy; berths are calypso's; the wire is calypso's. "Grant calypso host access" says whose policy changed. "Grant the daemon" does not.

  Operator-facing text now names it: the flag help, the not-running message, the already-running refusal, the listening banner, the attach errors, the several-sessions chooser, and the host-control sentences — `upload` refusing without the `files` tier, the HOST banner, and argus's HOST lamp tooltip.

  The start hints used to read `chell --daemon <user>@<url>` while the prose said "run calypso". They now say `calypso <user>@<url>`, which is a real command, since calypso ships its own binary. The getting-started guide leads with what calypso _is_, then gives both ways to start it — standalone from a saved session, or through chell logging in fresh — because they genuinely differ and one does not replace the other.

  **Daemon survives where it is correct**: a mode name, an anchor, a make target, a background process. Code symbols are untouched — `daemon_launch` and its kin describe something that really is a daemon, and churning them buys nothing an operator sees. Command lines inside code blocks were left alone, so nothing became a command that does not exist.

- f5c16fe: fix: a listing says what it could not read, and cat reports instead of crashing

  **A listing that could not read part of itself says so.** `ls` asks a folder for its directories, its files and its links, and a refused sub-listing was being dropped for looking like an empty one — so the home root whose file listing CUBE refuses rendered its folders alone, as though that were everything. The provider now names what it could not read (`Cannot fully list <path>: could not read files (Internal server error)`) and the listing carries that reason with the entries it did get.

  **`files_listAll`'s `null` meant three things** — an empty folder, a folder that is not there, and a folder the server would not describe — and nothing above it could behave correctly on one word that means all three. `files_listOutcome` says which: `listing`, `empty`, `missing`, `refused`. `files_listAll` stays as the lossy wrapper, but a refusal now throws rather than passing for absence.

  **A file is deleted by its id**, not by finding it in a listing first. The folder whose listing the server refuses is exactly the one an operator needs to clear, and a delete that walks the parent cannot help there. `chrisIO.file_deleteById` is the new door; other asset kinds still resolve through the group.

  **`cat` reports an unreadable path instead of ending the session.** A read that threw — a path that cannot be resolved, a server that refuses — escaped as an unhandled rejection that dumped an axios request object, auth header included, and killed the process. Each path is now resolved and read inside its own guard: the failure is reported like any other unreadable file, the rest of the line still runs, and nothing is dumped.

- ec3ef9f: fix: a listing shows what is there — no silent page limits

  `ls /net/pacs/queries` answered with 100 of 1,817 stored queries and said nothing about the other 1,717. That was one symptom of a pattern: callers reaching a single-page list call with a literal limit and returning the page as though it were the collection.

  **The default is now the collection.** A caller that names no limit gets a walk to exhaustion, not the first twenty. A caller that names one gets exactly that page, marked `incomplete` with what it is showing of what exists — a bound the surface can state rather than a truncation nobody sees.

  **A walk that stops says where.** CUBE fails some collection queries past an offset (measured: `userfiles` answers to offset 800 and returns 500 at 1000). The walk keeps what it gathered and reports where it stopped, rather than handing back a prefix that reads as an ending. A walk whose _first_ page fails is still a failure, since a listing that never started is not a short listing.

  **Three callers fixed:**

  - `pacs status` searched the first 200 queries for a matching expression, so anything older answered "not found". It walks now — verified live against a log of 1,897, finding query 3.
  - `getfacl` read a feed's first 100 grants. A hundredth name is not a natural place for that answer to stop.
  - A `ts` node's join edges are read from its parameters, which were fetched one page deep. A node with more parameters than a page silently lost its edges — a graph drawn short.

  **And a gate**, `npm run lint:listings`, in CI: a literal `limit` above one reaching a single-page list call fails the build unless the line says `listing-bound:` and why. Two bounds are declared today; both are exact-path lookups, not collections.

- 6234d55: test: a live exemplar proves a cohort answers for every patient asked

  Exemplar 11 drives the whole PACS plural path through `command_dispatchEnvelope` — the same entry chell uses — against a live CUBE and a real PACS.

  What it pins, in the order an operator would care:

  - **Every MRN asked has a row.** It counts rows, not hits: the answer an audit wants is usually the patients a hit-list would hide.
  - **Replay applies per patient.** The second ask of the same cohort is served from stored answers for the patient with imaging — same query id, provenance saying so — while the rows that found nothing are asked again, because an absence decays where a hit does not.
  - **A failure is not a miss.** Asked of a server CUBE does not register, the rows read `unasked` with a readable reason rather than zero studies. This is the property that needs a live PACS: a mock would only agree with whatever the code already does.
  - **The CSV round-trips.** `--csv-to` writes into CFS, `cat` reads it back, every row carries the same ten columns, and the misses are in the file.

  It needs no new fixture: the designated test accession names a study, that study names a patient, and that patient is the MRN known to have imaging. Every PACSQuery the run creates is deleted and the file removed, so the CUBE ends as it began. Self-skips with exit 2 where no PACS fixture is configured, and joins the nightly e2e list.

  One fix it drew out: the query model named its server with the raw `--pacsserver` argument, so a table asked with `--pacsserver 1` reported the server as `1`. The model now carries the canonical identifier CUBE files queries under, which is what `PACSDCM` means to an operator reading a CSV.

- 17964a9: fix: no write goes to a path the store already holds

  A write onto an occupied path leaves a row CUBE's own API cannot serve, and one such row makes **every** listing of that folder fail — the damage first seen as "the home root cannot list its files". It is reproducible in three commands, and all three ordinary write routes did it:

  - `mv a b` where `b` exists — its own PUT of `upload_path`.
  - `cp a b` where `b` exists — the copy uploads to an occupied name, and reported _success_ while doing it.
  - `upload a.txt` where `a.txt` exists — and this is the one that made the original rows. CUBE renames a colliding upload (`a.txt` → `a_VlIxMSp.txt`); mise then PUT the wanted path back onto the file, to undo a rename it read as spurious. That PUT is the damage.

  Each route now asks first, which costs one listing call and keeps the folder readable:

  - `mv` and `cp` refuse by name — `Destination exists: <path> — mise cannot overwrite a file; remove it first` — and a failed move or copy now reports the kernel's own reason instead of a bare `Failed to move` / `Failed to copy`.
  - `upload` renames back only when the wanted path is genuinely free, which is the case that rule was written for (a path deleted and not yet committed). Otherwise it keeps the name CUBE gave the file and says so: `'<path>' already exists — the upload landed as '<other>' rather than overwriting it`. A probe that cannot answer counts the path as taken, since the cost of guessing wrong is the operator's folder.

  The deliberate replace (`--csv-to --force`) is unaffected: it removes the file, waits for the path to stop resolving, then writes to a path that is free.

  `docs/CUBE-gaps.adoc` carries the reproduction, the mechanism and the client policy; upstream is ChRIS_ultron_backEnd#732.

- Updated dependencies [f5c16fe]
- Updated dependencies [116e8ba]
- Updated dependencies [ec3ef9f]
- Updated dependencies [7181f7e]
- Updated dependencies [d2a4315]
- Updated dependencies [a245b5f]
- Updated dependencies [5a339f0]
- Updated dependencies [17964a9]
- Updated dependencies [62761a3]
- Updated dependencies [17964a9]
  - @fnndsc/salsa@3.13.0
  - @fnndsc/cumin@3.18.0
  - @fnndsc/menu@0.4.0
  - @fnndsc/chili@3.6.6

## 0.16.1

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

## 0.16.0

### Minor Changes

- 5dc064e: feat(boot): warm-up leaves the gate, and a failure that leaves it is still heard

  Boot blocked on four prefetches in front of the prompt. Measured against a live CUBE, `/PUBLIC` costs 8.4 seconds and `/SHARED` 9.3 — roughly eighteen seconds an operator spent watching a prompt that was already theirs, buying freshness the stale-serve path delivers a moment later anyway, since the checkpoint restore has already put those listings in the cache.

  Boot now blocks only on `/bin`, which completion cannot work without: an empty completer reads as a broken prompt rather than a fast one. Groups, Feeds, Public and a newly added `/SHARED` step warm behind the prompt under a new `PENDING` boot status. They keep their bounded retry policy; a transient failure should be retried before it is announced.

  `/SHARED` had no step at all before. That is where another identity's work becomes visible, and with nothing to fail, a CUBE that stopped serving shared paths stayed silent until somebody went looking.

  **A deferred step leaves the boot failure gate**, so its failure can no longer stop a daemon binding — and a boot readout has scrolled away by the time it arrives. The failure is held until a later attempt succeeds and carried on the prompt context, so every surface says it: chell's prompt reads `[warm-up failed: groups]`, and argus names it on the JOBS readout in mars with the reason on hover. Named rather than counted, because "Groups" tells an operator which capability is degraded where "1 warm-up failed" only tells them to go looking.

  Nothing reports a deferred completion. A warm that finishes and changes nothing is not news.

  Carries AEGIS law `deferred-warmup-failure-persists` with its smoke, which drives the surface's real prompt-context path rather than asserting a stub.

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

- 73aa61a: The feed roster (`proc feeds`, the RUNS pane) reports each resident feed's total output size and wall span, derived from the cache with no wire; `cd` into a CFS link now follows it to its target, and a refusal names that target.

### Patch Changes

- 75f1e5f: fix(boot): a step's label stops moving when it finishes

  A boot step is announced while it runs and again when it settles, and the two lines disagreed about where the label starts. The running line hardcoded a five-space indent against a comment asserting `[ OK ] ` was seven characters wide; the finished line pads its tag to the widest tag and adds a space. The label therefore jumped a column as each step resolved, and the plain non-interactive log was out by three rather than one.

  The indent is now derived from the host's own tag width and from whether a spinner glyph precedes the text, since an animated line draws a frame and a space of its own and owes only the remainder while a plain log line owes the whole column. `chell` passes the width it actually renders with, so a longer status added later moves both lines together.

  The arithmetic lives in its own import-free module, because the wider engine graph cannot be loaded under jest and an untestable alignment rule is how the first version came to be wrong.

- 4f034b9: Host control: `chell --daemon --host-control[=shell,files,pipes]` lets the daemon declare capabilities of its own — `!` runs on the daemon host, pipe segments run there, `upload`/`download` reach its disk — off by default, refused on a non-loopback bind without `--expose-host-control`, and annunciated everywhere (attach ack `hostControl`, the daemon face, the prompt's HOST segment, a remote shell's banner). Without the `files` tier, `upload` under a daemon now refuses instead of reading the daemon host's disk.
- aa25502: The process cache records the compute resource each plugin instance ran on (from the CUBE list row), and the `feed.dag` model carries it per node (`mixed` for a group whose members ran on different resources), so a surface can hue a graph by where its work ran.
- f8d1b1c: Index movement is annunciated: a feed's first-visit topology load (`feed 812 indexing: 3400/20000 17%`) and roster arrivals (`+feed 812`, feeds created since or newly shared) reach the prompt context's `procWarmup` segment — `feed`, `arrived`, and `sweeping` so a renderer can tell a sweep from a load — and the chell prompt renders both. The process cache keeps the two registers (`feedLoad_progress/clear/get`, `arrivals_note/recent`); the salsa feed walk and roster syncs feed them.
- Updated dependencies [f73e6c2]
- Updated dependencies [5dc064e]
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
  - @fnndsc/salsa@3.12.1

## 0.15.0

### Minor Changes

- 920e0ac: The `feed.dag` wire model is now the COLLAPSED projection: isomorphic sibling subtrees merge into one ×N node (the terminal tree's own collapse transform), so a massive fan-out crosses the wire and reaches a rendering surface as its shape, not its census. Each collapsed node keeps a real representative instance (id and data address), wears its worst member's status (an error anywhere in the group is visible on the node that stands for it), sums member metrics, and carries a tally with jump-to-error anomaly ids.
- c716624: Directory listings survive a restart. The listing cache is checkpointed (identity-keyed file under `~/.cache/chell/vfs/`, throttled writes) and restored at boot with each entry's original timestamp, so a restored listing is exactly as stale as it really is. Stale handling itself is fixed: the listing path used to serve any cached entry regardless of its TTL (a listing never refreshed until eviction or `ls -f`). Now a fresh entry serves as is; a stale one is served at once and revalidated behind itself when a host can carry the refresh (the daemon publishes the fresh `fs.listing` on the ambient bus, marked `fresh`), and is refetched in line at a plain console. `ls` models carry `fresh` per listing; `vfs.listing_get` exposes the listing with its freshness.
- 97af423: Watches: a surface can keep a running feed live. New wire pair `watch` / `unwatch` (subject = `/proc/jobs/feed_N`, owned per surface, released on detach) and a `watched` report (`live` | `settled` | `stale`). While anyone watches a feed the engine samples it on an adaptive cadence (3 s while it changes, backing off to 30 s when quiet), and whenever a visit changes the cache it publishes the refreshed `feed.dag` model to every surface as a session-bus envelope from the `daemon` surface, off the scrollback. A feed that settles reports `settled` and the watch ends; a failed sample reports `stale` and keeps trying. `proc watch <feed>` / `proc unwatch <feed>` are the console forms (`proc watch` lists). The engine gains an ambient event bus for events it originates on its own. Feed visits within one second of each other now share one sync, and `feedVisit_sync` reports whether it succeeded.

### Patch Changes

- cece0dc: `/proc` freshness is now visit-driven. A revisit to `/proc/jobs/feed_N` (or a `feed diagram` re-render) is a delta, not a re-crawl: one feed-row fetch, and only when the job counters moved, a `min_end_date` walk of the nodes created or finished since the last visit plus an `active=true` sweep of the nodes still running. Nodes a dynamic pipeline spawns after the first load now appear on the next visit; previously they were invisible until `proc refresh`. Settled feeds are re-checked at most once per ten minutes, so work appended to a finished feed is still seen. A `/proc/jobs` visit (and `proc feeds` / `proc jobs list`) picks up feeds newer than the highest known id, and walks the whole index once the roster is older than ten minutes, so a feed shared later still appears.
- Updated dependencies [920e0ac]
- Updated dependencies [7a0f06e]
- Updated dependencies [c716624]
- Updated dependencies [cece0dc]
- Updated dependencies [97af423]
  - @fnndsc/cumin@3.16.0
  - @fnndsc/salsa@3.11.0
  - @fnndsc/menu@0.2.0

## 0.14.1

### Patch Changes

- 1bc0953: `ls` on a ChRIS link (`~/public`, `~/shared`) follows the link instead of rendering the link entry itself: the parent-cache leaf shortcut no longer captures links, so resolution falls through to the dispatcher's PathMapper. Native listings are also name-deduplicated (CUBE's links search can return the same row twice, observed on /PUBLIC).
- Updated dependencies [44ba77a]
- Updated dependencies [1bc0953]
  - @fnndsc/cumin@3.15.1
  - @fnndsc/salsa@3.10.1

## 0.14.0

### Minor Changes

- 85791b3: `config write <cfs-path> <base64>` — the durable layer's write path.

  Per-user surface state (argus desktops, and the config-in-CFS family to
  come) lives as files under `~/.config/...` in the user's CUBE home. Reads
  were always `cat`; this adds the write: content arrives base64-encoded,
  stages through a host temp file, and rides the same upload
  (replace-in-place on an existing document) the edit flow uses. Documents
  are notes, not datasets: 256KB limit.

## 0.13.0

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

- 31c2a50: `pipeline diagram` and `feed diagram` now carry their graphs as typed
  envelope models: `pipeline.diagram` (the authored topology) and `feed.dag`
  (the live instance graph with statuses and each node's `/proc` data
  address). The rendered trees are unchanged; a graphical surface reads the
  model where a terminal reads the text — one command, two projections.
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

- e062dbf: Two more commands speak in models: `proc feeds` (now listing the whole
  cache-resident roster when unqueried) carries a `feed.list` model, and
  `pacs query` carries a `pacs.query` model — studies and series with their
  instance UIDs and pullable VFS paths. Terminal renderings are unchanged.
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

- 87f7c59: The `pacs.query` model now says what CUBE already holds: each series carries
  a `pulled` flag and file count (one bounded sweep of single-attempt lookups),
  and studies carry their own VFS path so a surface can pull a whole study.
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

- Updated dependencies [1d600ac]
- Updated dependencies [a78b5ee]
- Updated dependencies [1c195a7]
- Updated dependencies [e58bf58]
- Updated dependencies [56ade16]
- Updated dependencies [2bb9c29]
- Updated dependencies [3125517]
- Updated dependencies [2c38d8b]
- Updated dependencies [b39b584]
  - @fnndsc/salsa@3.10.0
  - @fnndsc/cumin@3.15.0

## 0.12.0

### Minor Changes

- 0ad04f2: The engine can now hand raw file bytes to a hosting daemon: brasa's `BrasaEngine` gains an optional `file_read(filePath)` that resolves a ChRIS VFS path to a `Buffer` through chili's binary cat. Calypso's daemon exposes it as a token-gated `/vfs?path=&token=` HTTP route with extension-derived content types, letting a web surface render images and other binary content that a text transcript cannot carry.

## 0.11.1

### Patch Changes

- b0b478b: PACS payload and path-grammar consolidation. Cumin gains `dicomPayload`, the one home for DICOM query-payload interpretation (tag unwrapping including the DICOM-JSON `{Value: [...]}` form, study and series array location, UID lookups), replacing four diverged private copies. Salsa's `pacsHelpers` becomes the single authority for the PACS folder grammar, adding `folderUID_get`, `queryLabel_extractFromFolder`, and `queryFolderName_build`; the query path a surface builds now always matches the name the listing shows, including the title fallback the old builder lacked. Brasa's `pacsUtils` and `query` builtins consume the shared helpers; `pacs_tagValueExtract` remains as a compatibility alias.
- Updated dependencies [b0b478b]
- Updated dependencies [bb4e06a]
  - @fnndsc/cumin@3.12.0
  - @fnndsc/salsa@3.8.0

## 0.11.0

### Minor Changes

- 69b0617: Typed chell API, third tranche: `cp` and `mv` join the facade with their
  existing `fs.cp`/`fs.mv` models. Fixing what their first typed run
  surfaced: file rename was silently broken against current CUBEs (the PUT
  field drifted from `path` to `upload_path`); cumin now sends the current
  field and falls back for older servers.
- 7ed8e1c: Typed chell API, second tranche: `ls` and `cat`. `ls` gains the
  `fs.listing` model (entries per target as data), `cat` joins with its
  existing `fs.cat` outcomes and content in the rendered channel, and both
  enter the same cores the parsed builtins enter. Programmatic `cat` never
  injects syntax highlighting.
- 7dc3bca: The typed chell API, first tranche. `chellApi_create()` returns the shell's
  vocabulary as function calls: `pwd`, `cd`, `mkdir`, `touch` and `rm` take
  typed options, enter the same per-command cores the parsed builtins enter,
  and return envelopes whose model slot is typed per command
  (`TypedEnvelope<K>` over the new `FsModelMap`). No command line is
  assembled or parsed anywhere on the path.

### Patch Changes

- Updated dependencies [14f8ee8]
- Updated dependencies [4da2673]
- Updated dependencies [69b0617]
  - @fnndsc/cumin@3.11.0
  - @fnndsc/salsa@3.7.0
  - @fnndsc/chili@3.6.5

## 0.10.1

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

## 0.10.0

### Minor Changes

- 22db63f: Make PACS pulls observable and recoverable. A new `pacs status <expression | path | queryId>` reports one line per series: a fill bar of files registered in CUBE against the PACS-reported instance count, the derived state, and the in-CUBE `/SERVICES` folder for every landed series; an expression reuses the caller's most recent matching query instead of minting a new record per check. `pull` is now idempotent: series already fully registered in CUBE are skipped before firing, so re-running the same pull fetches exactly the missing series. Retrieve firing gets three attempts with backoff and is bounded to four concurrent creations, replacing the all-at-once stampede that overloaded CUBE and silently lost retrieves. A series whose firing still fails is reported as `FAILED TO FIRE, will not arrive; re-run pull`, distinct from watch-side failures, which now point at `pacs status` since their transfers usually complete server-side anyway. Cumin's status report gains the per-series storage folder (`seriesStorage_resolve`). The failure modes and operator playbook are documented in docs/pacs-pull-recovery.adoc.
- 590a943: Converge the two PACS retrieve watchers onto one engine. pull's battle-tested LONK machinery (bounded, retried firing; stall/timeout/no-activity detection; storage confirmation; refire loop) moves into salsa as the presentation-free `retrieve/watch` module; the `pull` builtin becomes a thin consumer rendering engine events onto its sink, and the PACS VFS provider's `cp` drops its 5-second polling watcher for the same engine, gaining firing retry, LONK push, and the idempotency skip. The convergence surfaced and fixed two latent defects that had made PACS `cp` unusable on real paths: the source parser assumed paths without the `/queries/` segment and rejected every real listing path, and the file downloader only consulted the userfiles collection, so PACS files under `/SERVICES` read as "not found"; it now falls back to the PACS files collection. Supporting dedup: cumin gains `retry_untilValue` (the one bounded-backoff loop) and `seriesStorage_resolve` gains bounded re-probing, replacing the per-package storage-resolver copies; the `_qid:` parser is now shared from salsa.
- b2f5ad3: Greet every surface with the stack's identity. Builds now record the short git hash they were produced from (`dist/buildinfo.json`, written by the new `scripts/buildinfo.mjs` build step), and brasa exposes it through `buildHash_get` alongside `welcomeLine_build`/`welcomeLine_compose`, which render a banner of the form `ChELL Executes Layered Logic, v 5.3.0 (886f09). Welcome.` An interactive chell session prints the banner and a short fortune at boot, the calypso daemon announces its banner plus an aligned version line for every stack layer (chell, brasa, chili, salsa, cumin, calypso) when it starts listening, and the attach handshake gains an optional `stack` field carrying all six versions and the build hash, so a remote surface banners the daemon's full reported stack rather than its local install's. `fortune_random` is exported for reuse, with an optional line-count bound so banners favour short cookies.

### Patch Changes

- 2e60785: Cache the `/etc/group` projection per CUBE connection for five minutes,
  invalidate it after ChELL membership changes, and show semantic inspection
  progress while an uncached projection is resolving.
- 66bc932: Add ChELL group membership commands and include current CUBE usernames in the
  live `/etc/group` projection.
- 8ec8a4b: Add explicit, command-scoped CUBE elevation with `sudo <command>`. The active surface collects an administrator identity and hidden password; a temporary CUBE client runs only the nested command, then the normal session is restored. Group membership and plugin registration now suggest a copyable `sudo` rerun after an authorization failure, and plugin registration no longer owns a separate interactive admin prompt.
- d0ac04f: Preserve failure causes and tighten cache contracts. Errors that were replaced by generic messages now carry their real cause: controller and handler creation failures name the underlying error instead of "no ChRIS context", `cat` shows the actual fetch failure, docker command failures surface stderr detail, context-set errors actually print, settings load/save failures are announced instead of silently using defaults or losing changes, unreadable berth and discovery files are named instead of reading as "no daemon", token-file read errors are distinguished from the logged-out state, and resource deletes report why they failed. Every remaining deliberate error absorption now carries a dated adjudication comment. Cache contracts: the PACS provider's decoded-query cache caches settled results only and is size-bounded; the object-context factory gains an eviction hook (`objContext_evict`) for deleted plugin or feed ids; `mv` and `cp` invalidate the whole affected listing subtree; and a new PACS query invalidates the cached `/net/pacs/queries` listing so it appears in the next `ls` immediately.
- 886f09c: Fix stale directory state in long-lived daemons. Folder object contexts are no longer cached in the cumin context factory: folder paths are not stable identities in CUBE (deleting and re-uploading a directory assigns a new folder id), so a group bound at first touch kept serving the dead folder for the life of the process, which in a calypso daemon meant a freshly uploaded directory listed as permanently empty and `ls -f` could not recover it. Plugin and feed contexts keep their stable-id cache. The listing cache gains `cache_invalidateTree`, and `rm` and directory uploads now invalidate the whole affected subtree, so a delete-and-re-upload cycle cannot serve still-fresh nested listings from the old tree. The salsa native provider also distinguishes a missing folder from an empty one: when every sub-listing comes back empty it probes the parent, and a nonexistent path reports "No such file or directory" instead of rendering as an empty directory.
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
- Updated dependencies [50e9bb1]
- Updated dependencies [d0ac04f]
- Updated dependencies [22db63f]
- Updated dependencies [0e92d4d]
- Updated dependencies [590a943]
- Updated dependencies [fa81126]
  - @fnndsc/salsa@3.6.0
  - @fnndsc/cumin@3.9.0
  - @fnndsc/chili@3.6.2

## 0.9.9

### Patch Changes

- Keep `cat /bin/<pipeline>` immediate with a cache-only executable summary;
  move complete registered invocation YAML and delayed inspection progress to
  `pipeline manifest <specifier>` and `<pipeline> --manifest`.
- Updated dependencies
  - @fnndsc/salsa@3.5.5

## 0.9.8

### Patch Changes

- Emit delayed semantic progress when an exact `/bin` Pipeline manifest read
  takes longer than 300 milliseconds, while leaving fast cache hits silent.

## 0.9.7

### Patch Changes

- Resolve exact `/bin` Pipeline reads without global Pipeline enumeration or
  per-node hosted-plugin metadata requests, cache repeat reads, and render
  Pipeline topology in linear time.
- Updated dependencies
  - @fnndsc/salsa@3.5.4

## 0.9.6

### Patch Changes

- Run registered pipelines with node-qualified parameters, compute/resource
  controls, and strict CFS YAML overlays; expose registered manifests through
  `/bin`, contextual parameter help, and completion.
- Attach one plugin or pipeline after `pacs pull --new-feed`, preserving the
  valid Feed and root when attachment fails.
- Preserve shell-tokenized spaces, negative values, booleans, and `--name=value`
  across plugin and pipeline executable arguments.
- Updated dependencies
  - @fnndsc/cumin@3.8.4
  - @fnndsc/salsa@3.5.3

## 0.9.5

### Patch Changes

- Add `pacs pull --new-feed "TITLE"` to create one named analysis feed from a
  completely retrieved PACS selection, with explicit feed/root IDs and
  all-or-nothing handling for partial or unresolved pulls.
- Updated dependencies
  - @fnndsc/cumin@3.8.3
  - @fnndsc/salsa@3.5.2

## 0.9.4

### Patch Changes

- Add controllable syntax highlighting to `cat`, including Python and other
  popular source/configuration formats, while keeping ordinary pipes and
  redirects ANSI-free.

## 0.9.3

### Patch Changes

- Carry cold, cached-refresh, and failed `/proc` lifecycle state through the
  CALYPSO prompt contract; reorder p10k segments and render distinct lifecycle
  clues for local and remote surfaces.
- Updated dependencies
  - @fnndsc/cumin@3.8.2

## 0.9.2

### Patch Changes

- 6f0833a: Release the coordinated ChELL stack with deterministic `/proc` topology progress, complete visible-feed indexing, safe warm-up query gating, remote one-shot command completion, and refreshed daemon documentation.
- Updated dependencies [6f0833a]
  - @fnndsc/cumin@3.8.1
  - @fnndsc/salsa@3.5.1
  - @fnndsc/chili@3.6.1

## 0.9.1

### Patch Changes

- 71a6cd4: Route a pipeline executable's bare `--signalflow` flag to SignalFlow diagram output and provide contextual help for dynamic pipeline commands. Keep final-segment redirection on the originating surface, propagate remote pipe-segment failures back to the engine, and prevent remote command errors from terminating the interactive ChELL client. Daemon mode now reports shared startup cache warming and publishes its listening berth only after engine readiness. Consistently document `signalflow -` for stdin rendering.

## 0.9.0

### Minor Changes

- e630f79: Draw registered CUBE pipelines with `pipeline diagram <id|name>` or the `/bin` shorthand `<pipeline> --diagram`. Bare output uses the same shallow tree machinery as feed diagrams, `--withargs` appends stored non-null plugin defaults, and `--signalflow` emits the same SignalFlow YAML dialect as feeds. `feed diagram <specifier>` is now a shallow alias of `feed tree`; feed graph commands accept IDs, `feed_N`, exact or unambiguous title searches, and infer the feed from the current `feed_N` directory when omitted.

### Patch Changes

- e630f79: Classify CALYPSO as the assisted session host, rather than a user-facing surface, in the detailed stack information report.
- Updated dependencies [e630f79]
  - @fnndsc/cumin@3.8.0
  - @fnndsc/salsa@3.5.0

## 0.8.0

### Minor Changes

- 8ac7ef9: Add `feed diagram --signalflow <feedId>` — emits a feed's DAG as a **SignalFlow YAML
  document to stdout**, composed with pipes rather than rendered in place:

  ```
  feed diagram --signalflow 1669 | signalflow -            # ASCII
  feed diagram --signalflow 1669 | signalflow - -o x.svg   # SVG
  feed diagram --signalflow 1669 > feed-1669.yaml          # keep it
  ```

  It builds the graph cache-first, collapses isomorphic siblings into named `×N` chips, and
  encodes topological-join edges via SignalFlow's node-reuse mechanism. mise emits the
  representation only — no renderer is invoked, discovered, or bundled — so there is nothing
  to install for the command itself; rendering is the user's own `signalflow`. `--signalflow`
  names the dialect, leaving room for further emitters (`--json`, `--dot`, …).

## 0.7.0

### Minor Changes

- b8ae635: `feed tree` now collapses isomorphic sibling subtrees by default. Structurally-identical
  branches merge into one `×N` template node showing a proportional status bar, per-category
  counts (`97✓ 2⋯ 1✗`), and the ids of any non-done members (error first) so failures stay
  addressable. Collapsed groups use a double-line connector to signal multiplicity. Pass
  `--flat` to draw every node individually.
- ca63e8b: Add `feed tree <feedId>` — renders a feed's plugin-instance DAG as an annotated text
  tree. The anchor tree is drawn with box-drawing connectors; topological-join (`ts`) nodes
  are annotated inline with the extra sources they merge (`⋈ joins ...`). Supports
  `--focus <id>` to scope to a subtree and `--max-nodes <n>` to cap output (0 = all). The
  envelope carries a typed `feed.tree` FeedGraph model.

### Patch Changes

- 01ab743: `feed tree` now builds the DAG **cache-first** from the warm ProcCache instead of
  re-crawling the feed on every call. It reuses already-loaded topology, fetches feed
  metadata only when missing or a placeholder, refreshes volatile status cheaply (one
  feed-scoped list call, active nodes only) when reusing a warm cache, and resolves join
  edges lazily. New salsa exports: `feedGraphData_ensure`, `feedMeta_ensure`,
  `feedInstances_ensureLoaded`, `feedStatus_refresh`.
- Updated dependencies [a1f6694]
- Updated dependencies [01ab743]
  - @fnndsc/cumin@3.7.0
  - @fnndsc/salsa@3.4.0

## 0.6.1

### Patch Changes

- 0d358c5: /proc now caches settled job status. A finished plugin instance
  (`finishedSuccessfully`, `finishedWithError`, `cancelled`) never changes, so its
  status is kept permanently once observed. Consequences:

  - Listing a fully-finished feed under `/proc/jobs` is instant — no status calls.
  - Live status for active feeds is refreshed with a single feed-scoped list call
    (the list response already carries `status`) instead of one detail fetch per node.
  - Reading a settled instance's `status` returns the cached value without an API call.

- Updated dependencies [0d358c5]
  - @fnndsc/cumin@3.6.0
  - @fnndsc/salsa@3.3.0

## 0.6.0

### Minor Changes

- e5a30f7: Add `date` and `cal` builtins, in the spirit of their UNIX namesakes and fully self-contained (pure computation — no host binary, no subprocess). `date` prints the current date/time with the familiar default format, `-u` for UTC, and `+FORMAT` strftime-style format strings (it reports the time only, never sets the clock). `cal` prints a month (`cal`), a whole year (`cal <year>`), or a specific month (`cal <month> <year>`), with today highlighted. Both return their output in an envelope through the sink, so they work identically local, over a CALYPSO daemon, and in the standalone binary.

## 0.5.0

### Minor Changes

- c2087d0: Add a `fortune` builtin — the classic UNIX fortune cookie, as a shell builtin. It prints a random fortune and is fully self-contained: the content is bundled (vendored from the traditional fortune-mod datfiles, classic BSD `fortune` material), so it needs no host `fortune` binary and no datfiles on disk, and behaves identically in a local shell, over a CALYPSO daemon, and in the standalone binary. Output travels in an envelope through the sink like every other command. Regenerate the bundled set with `scripts/fortunes_generate.mjs`.

## 0.4.0

### Minor Changes

- 880d37a: `chell --version` reported brasa's version in place of chell's: the version module moved into brasa during the engine split but still read its own `package.json` as "chell", so it printed brasa's number. It now resolves every package by name (reading brasa's own directly) and reports the full stack — chell, brasa, chili, salsa, cumin, calypso — with versions aligned in a column. A new `chell --info` flag prints a role-grouped table (surfaces / engine / layers) of each package, its full name, and version. The version report, the `--info` table, and the boot panel all draw from a single source of truth in brasa (`stackInfo_get`), and the standalone binary inlines every stack version at build time.
- e43f42a: Delegating an unknown chell command to chili no longer stalls or floods the terminal with context-init errors when the current directory is a pure-VFS path (`/proc`, `/net`, ...). chili now registers its file-group and plugin-context commands without resolving any ChRIS context — each controller is created lazily, only when a command's action runs — so an unrelated command (or a directory that is not a ChRIS folder) pays no network cost and produces no setup-time error wall. chili also exports `commandNames_get()`, a cheap network-free listing of its top-level commands. In brasa, the "delegating to chili" notice is now emitted on the live sink before chili runs, so it appears ahead of chili's output instead of after it; and a command chili does not know (a typo, a host program) is reported as `command not found` without delegating at all.

### Patch Changes

- 512e14f: Fix `<command> --help` leaking to a daemon's terminal instead of reaching the surface. The `--help` flag path printed help through `console.log`, which on a CALYPSO daemon landed on the daemon's own terminal — and returned an empty envelope, so a remote surface saw nothing. Help now travels in an envelope through the sink like every other command output, so `--help` reaches the surface that asked for it and never prints on the daemon. This removes the last console-based path in the help flow (`help_show`).
- Updated dependencies [e43f42a]
  - @fnndsc/chili@3.6.0

## 0.3.0

### Minor Changes

- a0d3df5: The engine no longer intercepts the console anywhere. The pipe/redirect `output_capture` monkeypatch is deleted: pipes now capture through a `PipeCaptureSink` scoped over the (re-activated) `AsyncLocalStorage` sink scope, ANSI-stripping text writes and keeping binary writes (a raw `cat` of a DICOM file) byte-for-byte. `chiliCommand_run` drives chili through its `run_capture` seam and returns an envelope, so the pacs passthroughs and the unknown-command fallback are envelope-based. The remaining print-direct builtins are converted: `store`, `upload`, `download`, `connect`, `edit` return envelopes, while the streaming commands `pull`, `pipeline`, and `pacs` emit incremental output through the sink so it streams live to a terminal or daemon and is captured in a pipe.

### Patch Changes

- Updated dependencies [a0d3df5]
  - @fnndsc/chili@3.5.0

## 0.2.0

### Minor Changes

- d69b086: Every printing builtin now returns a `CommandEnvelope` instead of writing to the console. `files`/`links`/`dirs`, `feed`, `plugin`, and `parametersofplugin` were the last holdouts; with them converted, the per-invocation console monkeypatch (`printingHandler_wrap`, which hijacked `console.log`/`console.error`/`process.stdout.write` to capture a builtin's output) is deleted, along with the `LiveEnvelopeOutputSink` marker that only served it.

  Behavioural notes: unknown subcommands of these resource commands now return a clear error envelope instead of spawning a chili subprocess, and `search` is handled natively via `list --search`. The unknown-_command_ fallback still delegates to chili, now over the same print-direct path as the other unconverted handlers.

### Patch Changes

- Updated dependencies [d69b086]
  - @fnndsc/chili@3.4.0
