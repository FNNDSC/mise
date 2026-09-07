# @fnndsc/argus

## 0.1.0

### Minor Changes

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

- 78d85ae: feat(argus): a location is asked for by borrowing a browser

  An ask is never a box. A `path` question opens the instrument that already shows that space: a **new** files pane beside the pane that asked — never an existing browser, since hijacking one loses the operator's place — anchored where the ask said, closing when the errand ends either way.

  Its controls ride a bar of its own across the top of the pane: the question as a caption, the composed path as an editable field, **MKDIR** for a folder that does not exist yet, and one verb that commits, reading the word the kernel sent (`EXPORT HERE`). The grill had put those on the mode frame; building it showed why they cannot live there — the frame is a narrow rail against the spine, right for a column of capsules and hopeless for a caption and a path, and it answers to what the _field_ holds, which an errand does not change.

  Three defects the live run turned up, each fixed here:

  - **The errand opened an empty browser, forever.** The daemon runs commands one at a time, so the listing that would answer the question queued behind the command that asked it: the answer waiting on the browsing, the browsing waiting on the answer. An instrument command now runs **beside** a command waiting on a question — the natural twin of the rule that an instrument may never ask. A pane's own read neither asks nor waits, and the daemon saves and restores the executing command rather than clearing it, so the outer command's output still finds its way home.
  - **The errand split beside the focused pane**, which can be one the current preset does not hold. A split beside a pane that is not in the tree fails silently, and an errand that never opens is a question asked of nobody. The host is now a leaf that is actually on stage.
  - **The anchor could be somewhere nothing can be written.** A session sitting in `/bin` or `/proc` is browsing a provider, not standing where a file lands, so the ask falls back to home rather than offering a destination that is refused the moment it is committed.

  Law `an-ask-borrows-an-instrument`, smoke-enforced. Two consecutive full smoke runs, 103 checks.

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

- 671b188: feat(argus): a control lives where it acts — the browser's drawer is sorted

  The browser's drawer held three scopes in one costume: FOLLOW CWD and ROOT HERE, which say what the pane is bound to; HOME and BACK, which move where the field points; and DOWNLOAD and DELETE, which act on a row. Six capsules on one strip, with nothing to tell an operator which of them would act on what.

  They are sorted now, and nothing new was added while sorting them.

  - **Binding joins the binding group**, beside LINKED FS, because what the next split creates and what this browser follows are the same kind of sentence. The pair reads as a radio, since a browser either follows the session or holds its place, and it reads back whatever changed the binding — the drawer, the language, or a split born rooted.
  - **HOME and BACK move to the mode frame**, the thing that answers to the field. They stand down while a diagram holds it: a graph is not a listing and has no home to go to.
  - **DOWNLOAD and DELETE leave the drawer.** The intents stay: they are host capabilities now, which the console language presses today and a row's own action track presses next, so neither control has to know where the other one is.

  What is left is two groups and a shorter sentence: shape the tile, bind a neighbour.

  Law `a-control-lives-where-it-acts` in `docs/aegis.adoc`, with a smoke scenario that finds each verb in its new home, finds the drawer with two groups, and walks a rooted browser home, into a folder, and back.

- ba1e5b4: feat: a PACS answer can be written as a table a spreadsheet reads

  `--csv` renders the answer; `--csv-to <cfs-path>` writes it into ChRIS storage; argus's EXPORT CSV lowers visibly to the second, as GATHER's SAVE already lowers, so the operator reads the command that ran.

  Two flags rather than one with an optional value: `--csv PatientID:1234` cannot tell a destination from a query expression, and guessing wrong writes a file named after a patient.

  **Why a CFS destination exists.** A local terminal needs none — `--csv > audit.csv` writes the operator's own disk, because engine and operator share a filesystem. A detached surface does not: the engine runs on the daemon's host, so a redirect lands on somebody else's machine (#415, where `>` also turns out to bypass the `engineFilesystem` capability built to prevent exactly that). A cohort's MRNs and study descriptions stay inside ChRIS, and the file browser or `download` retrieves them.

  **The table's shape carries the level above's doctrine**: a row per study, and a row for every patient that owns none. A table built from studies alone would silently drop the misses, which are what an audit is usually asking about. `ANSWERED` carries an ISO timestamp rather than `3 MONTHS AGO` — a spreadsheet sorts dates; a phrase is for a human glance.

  Every cell is quoted and embedded quotes doubled, the rule chili's `--csv` has always followed, now stated as a function rather than left inside a handler nothing else can call — so a study description like `MRI BRAIN, W/ AND W/O "GAD"` survives the trip.

- b5b0c8f: feat(argus): the MRN is the outermost level, and a miss is an answer

  The PACS listing gained its patient level — always, not only when a cohort was asked. Every patient asked gets a row, hits and misses alike, because the MRNs that come _back_ are by definition the ones with imaging, which makes the answer an operator usually wants — which of these two hundred have none — the invisible half of the result.

  Three states, distinguishable at a glance: a hit reads its counts, a miss reads `0` with a dim track, and a row nothing could be asked of reads `UNASKED` in the mars hue, its reason on the title — never a zero, because a zero says the PACS answered, which is the one thing a timeout did not do. The pane's bar carries all three as `FOUND 2 · NONE 2 · UNASKED 0`, derived from the rows so the summary cannot disagree with what is on screen.

  **ANSWERED is a column.** A fan-out replays some rows and troubles the PACS for others, so provenance is per row; sorting on it lifts the stale rows to the top, and a row with no answer sorts to the far end rather than pretending to be old.

  **Progress sums at this level too** — every series under a patient, added and never averaged — and a level holding one row opens itself at every level, so an accession query still costs no gesture while a cohort arrives folded.

  Two things the live run settled:

  - The FILTER pill read the _study_ order's strip while toggling the outermost one, so it reported OFF with the strip standing open.
  - The study level is not indented. The form's DATE, ACCESSION and MODALITY fields stand over the study caps, and an indent pushed those columns 26px out from under the fields that fill them; the nesting is said by an inset shadow, which costs no horizontal space.

  Law `a-set-says-what-became-of-every-member`, smoke-enforced (`SMOKE_PACS_COHORT`), alongside five new scenarios over a live cohort.

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

- 801a41a: feat(argus): a plugin is the one-node case, not a wall of text

  `/bin` held two kinds of thing that behaved like two applications. A pipeline was a picture you could open; a plugin was prose you scrolled — the wall of scraped text the operator called exhausting.

  A plugin is now the graph with one node in it, and there is no third rendering:

  - **preview** — its card carries that node, drawn by the shared ranked layout a pipeline's card uses. It costs no fetch: a plugin is one node whatever it declares, where the card used to spend a `cat` per entry to print a paragraph.
  - **detail** — the same stage with the same mode frame, so PULSE, RANKED/MOLECULE and 2D/3D act on it as on any graph.
  - **immerse** — its node opens as its parameters, flag on the left and what the flag takes on the right, from the `plugin.info` model.

  A pipeline node reads out the arguments an author already FIXED; a plugin reads out the ones nobody has fixed yet. One painter renders both, so the two readouts cannot drift.

  **A view is closed by the operator, never by an arrival (#425).** Found live while proving this: opening a /bin entry fetches its graph into a mount, and a listing arriving a moment later replaced the whole view — the fetch then resolved onto a mount no longer in the page, and the stage stayed empty. A listing now lands under whatever is being read, and CLOSE or Esc shows it. The smoke scenario that slept three seconds to dodge that race no longer needs to.

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

- 3df1c41: docs(calypso): say calypso where the component is meant, and make it typeable

  Every other part of the stack is a noun with a role — cumin, salsa, chili, brasa, menu, chell, argus. The session supervisor was the odd one out, described by a flag on another program, so the prose said "the daemon" for something that already has a name, a package, a binary and a doctrine document.

  Host control is _calypso's_ policy; berths are calypso's; the wire is calypso's. "Grant calypso host access" says whose policy changed. "Grant the daemon" does not.

  Operator-facing text now names it: the flag help, the not-running message, the already-running refusal, the listening banner, the attach errors, the several-sessions chooser, and the host-control sentences — `upload` refusing without the `files` tier, the HOST banner, and argus's HOST lamp tooltip.

  The start hints used to read `chell --daemon <user>@<url>` while the prose said "run calypso". They now say `calypso <user>@<url>`, which is a real command, since calypso ships its own binary. The getting-started guide leads with what calypso _is_, then gives both ways to start it — standalone from a saved session, or through chell logging in fresh — because they genuinely differ and one does not replace the other.

  **Daemon survives where it is correct**: a mode name, an anchor, a make target, a background process. Code symbols are untouched — `daemon_launch` and its kin describe something that really is a daemon, and churning them buys nothing an operator sees. Command lines inside code blocks were left alone, so nothing became a command that does not exist.

- 04004cd: refactor(argus): one frame-and-field host for the tabular panes

  The files listing and the runs roster arrived at the same arrangement separately — mount a `RosterOrder` frame, append a scrolling field beneath it, fill the field with rows — so the arrangement was copy rather than shared code. A fix to one had to be written again for the other, and the stylesheet carried two field rules differing only by a `padding-right`.

  Both now use one host. The duplicated `field_open` is gone from each panel and the two rules collapse to a shared `.listing-field` plus a one-line files override.

  The host is deliberately narrower than planned. It was to own the state line and the empty state as well, but reading the panels closely those only resemble each other: the files bar toggles a single class and joins parts, while the runs bar swaps among three liveness classes and stays silent while a graph is on stage. Pulling them together would have changed behaviour, so they stay put, and the reasoning is recorded in the module rather than left to be re-litigated from resemblance.

  Nothing an operator sees changes. The argus smoke suite passes unedited at 63 checks, which is the evidence.

- 116e8ba: feat(listing): progress is a trait of a row, and a row can carry verbs

  The operator's observation: progress is not a PACS quirk. A feed row should say how far its work has got without anyone opening it, and every level should report — a series its own pull, a study the sum of its series, a patient the sum of its studies.

  **The wire could not say it.** The `feed.list` model carried id, title, owner, status, created and two totals that need resident topology, so a roster genuinely could not know a feed's progress. CUBE's own job counters were already on the process cache, so the kernel now derives `jobsDone` and `jobsTotal` from them — settled meaning finished, errored or cancelled — and they travel with the feed row rather than waiting for topology. Kernel, wire, surface, in that order.

  **Progress aggregates by addition, not by average.** A study's progress is the sum of its series'. An average would let one finished series of a hundred files outweigh a stalled one of ten thousand.

  **A row with nothing scheduled still gets a track**, dimmed. The absence of a bar reads as "no such thing"; a dim track reads as "nothing has happened yet", which is the truth and the more useful statement.

  **Actions are not traits.** A trait says what a row is under some column; an action is a verb applied to it, and it sits outside the column grid because it answers to no cap. Capsules stop click propagation, so pressing one is not also activating the row.

  **Expansion has two modes**, declared rather than assumed: `replace` leaves the parent behind, `fold` keeps it on stage with the child inside. PACS exercises both in the next slice.

  The runs roster gains NODES and PROGRESS, which widened its positional track list from seven columns to nine.

  One smoke assertion changed, and deliberately: it counted seven cells per row as a literal. It now counts cells against the number of caps, which is the invariant that actually protects a positional grid and needs no edit when a column is added.

- c721edc: refactor(argus): a listing column is declared once

  Both tabular panes said what their columns were twice: once to `RosterOrder`, which draws the caps and sorts by them, and again in the code that emitted each cell. The two could not drift visibly, because the grid would break, but they could drift in meaning — a cap saying one thing while the cell beneath it showed another.

  A trait now carries the cap's label, the cell's class, what the cell holds and how rows compare under it. `RosterOrder` takes its caps and its comparator from the same declaration that emits the cells, so the two cannot disagree.

  Comparison defaults to the cell's own text, so a column declares an ordering only where display and order genuinely differ: a size shown as `1.2 MB` sorting by bytes, a date shown short sorting by its full stamp.

  Row state stays out of the model. `files-denied`, `feedlist-arrived` and the status classes mark a row, not a column, and forcing them through a column model would say something false about them. A pane supplies them through its own hooks, and the module records why so the next reader does not unify them on resemblance.

  Nothing an operator sees changes. The argus smoke suite passes unedited at 63 checks, including the scenario that sorts and filters by these very columns.

- e5483dd: fix(argus): state wears the theme's colours, not literals

  The operator noticed the PACS progress bar was "all green-ish, looks out of place". It was: a hardcoded `linear-gradient(90deg, #2a5, #3c6)` on a surface where every other colour is a theme token. Looking properly, there were ten such literals — feed status, PACS badges, the subway diagram's failed stop, the offline lamp, the audio pill, the attach error — each ignoring whichever LCARS scheme is active.

  Worse, `--mars` was **referenced five times and defined nowhere**. Every rule using it had been silently inert: the refused-row colouring added yesterday, its strike-through tint, and the WARM-UP FAILED readout were all falling back to inherited colour rather than showing red. An undefined custom property fails quietly, which is why it looked plausible.

  State hues are now declared once and derived from the theme's seven base colours, so they follow the scheme: done from daybreak, running from orange, idle a dimmed pumpkin-pie for a track where nothing has happened yet. Error is the deliberate exception, mixed toward the palette rather than taken from it, because danger must not blend into a warm scheme.

  Chrome that is red _by design_ rather than by state — the LCARS close pill — gets a real `--mars` token of its own, so the two meanings stop borrowing each other's colour.

  No literal state colours remain. Smoke passes unedited at 63 checks.

- Updated dependencies [a7f057c]
- Updated dependencies [78d85ae]
- Updated dependencies [3df1c41]
- Updated dependencies [116e8ba]
- Updated dependencies [7181f7e]
- Updated dependencies [d2a4315]
- Updated dependencies [a245b5f]
- Updated dependencies [9e2a9dd]
- Updated dependencies [5a339f0]
- Updated dependencies [62761a3]
  - @fnndsc/calypso@0.10.0
  - @fnndsc/menu@0.4.0

argus is not published to npm, so changesets writes no changelog for it. This file is that record, kept by hand.

## 2026-09-04

fix(argus): the operator divides the stage, not a constant

The console could not be dragged past roughly half the frame. The drag had no cap of its own; the wall was a `min-height: 20rem` workspace floor on `main`. A floor there is a ceiling here, because the drawer can only grow into space the workspace will give up, and the floor was lifted only for the console's own zoom.

The floor is gone. The drag is now bounded only by what the screen imposes: a minimum so the strip stays grabbable, and a ceiling that keeps the console's own header on screen so the controls that shrink it again remain reachable.

fix(argus): the PACS listing uses the space it has, and the header slide stops guessing

**The progress bars sat where there was no room.** A series row put the description on `1fr` and the bar in a fixed cell wedged between the file count and the capsule, so the description hoarded a thousand-odd pixels of empty width while the bar had a few dozen. The description now takes what it needs up to a limit and the bar takes the rest, stretching from the description across to the modality.

**Enter runs the query** from any term field, not only the command line. Filling a field and pressing return is what a form means.

**Waiting is visible.** A query in flight shows a pacing bar and says so, rather than one line of static text that reads like a finished empty result. A pull in flight now draws a bar that fills by current over total, and paces when there is no total instead of pretending to a fraction it does not know; previously it only changed a word.

**A study wears the same frame as any other listing**, in the roster's own idiom: a bar of caps naming SERIES, STATE, MODALITY and FILES, sharing the row's track definition so each cap sits over its column.

**The header's slide distance is no longer a stale measurement.** It was captured once at the moment of the gesture, but the header's height is not fixed — version rows arrive from the daemon after attach — so the slide could fall short by anywhere from one to thirteen pixels depending on timing. It now tracks the header's resting extent and freezes during the slide, since zooming hides the lid and makes the header shorter than the distance it has to travel.

fix(argus): runs-02 gets the same frame treatment, and 02-CALYPSO matches ARGUS WEB

The runs roster shared one scrolling box with its caps, so its scrollbar ran the full height of the pane and up behind the frame — the same defect the files browser had. The caps now sit above a scrolling field, and the roster shows as a flex column rather than a block.

The version face stops being its own design. It had picked up a private set of overrides — smaller label pills, shrunken fonts, tightened line heights, a bespoke grid — none of which the ARGUS WEB face uses. They are gone. It now uses the same three-column idiom, the same type and the same pill width, verified against a live daemon: both faces report three columns, a 15.4px label, a 19.8px value and a 209px pill. The cycler gives back the width to make room, from two fifths of the band to under a third.

One structural correction stays: the columns belong on the readout, not on the face. The rows live inside an `about-rows` wrapper, so columns set a level above it fragment the wrapper rather than its rows, which left every row in the first column and the rest of the band empty.

Values still elide rather than wrap, so a long git hash or build date cannot disturb the layout, with the whole text on hover.

test(argus): the smoke suite waits for motion to stop instead of guessing how long it takes

Several scenarios slept a fixed number of milliseconds after a gesture that animates, then measured. That samples a CSS transition at an arbitrary moment: sometimes mid-glide, sometimes before the click had even registered. The header-slide check drifted between one and thirteen pixels of residue and occasionally read the header's full resting position, and the split-zoom, restore-strip and mode-frame checks flickered alongside it.

Scenarios now wait for the value under test to stop changing. The checks are stricter as a result, not looser: the header-slide tolerance goes back to a single pixel, where it had been widened to two to accommodate the noise.

No production behaviour changes here. The one thing worth stating plainly is what this was not: the slide distance was correct throughout, and two attempts to "fix" it in the page were reverted once the suite could measure it honestly.
