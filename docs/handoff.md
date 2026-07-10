# Handoff: CALYPSO stage 1 — remaining task-4 work

Date: 2026-07-07. Repo: `/home/rudolph/src/mise`, branch `main`, clean.

> **STAGE 1 COMPLETE.** Epic #55 closed 5/5. All merged: PR #54 facade (#56),
> #61 prompt capability (#57), #62 error drain + fence (#58), #59 progress
> (assessed/deferred), #63 exit gate (#60, merge `5666e3f`). Exit gate passed:
> 1948 unit tests green across cumin/salsa/chili/chell (by exit code), live
> exemplars 01–04 green against ekanite, byte-identical CLI (documented
> pipe-ANSI deviation). calypso.adoc Results records it. **Next: stage 2 — the
> session daemon** (see "Deferred to stage 2" below and calypso.adoc appendix
> "stage two"). The component sections below are kept as the stage-1 record.

**Deferred to stage 2 (daemon):**
- **Structured progress over the daemon wire** (from #59): cli-progress emits
  terminal escape frames — wrong shape for a remote surface, which needs
  structured progress facts. The contract is now recorded in
  `docs/structured-progress.md` and issue #70. Progress is a distinct
  `progress` message, not `output {channel:'status', chunk}`.
- **Surface owns the local editor** (from #57): local-edit is a declared FLAG
  today; add a `Surface.localEdit()` method when a remote editor implementation
  exists to justify the abstraction (avoids the byte-compat regression in
  edit's save-failure recovery that a premature move would cause).
- **Harness note:** driving `04_pacsQR` end-to-end needs a BACKGROUND run — PACS
  Q/R exceeds the 10-min foreground timeout (that's a harness limit, not a bug).

This file is deliberately uncommitted — do not include it in feature PRs.

## STAGE 2 — session daemon (scaffolded; HARBOR epic #64)

Full plan = the epic #64 body + `calypso.adoc` appendix "stage two". New
package `packages/calypso` (`@fnndsc/calypso`): a WebSocket host over ONE chell
engine; loopback bind + random attach token (printed + user-readable file,
constant-time compare); CUBE creds never cross the wire; session bus broadcasts
every envelope to sibling surfaces. Singletons stay INTACT — per-user auth and
the cumin session-scoping refactor are stage 4; do NOT half-build them here.

**#65 wire contract MERGED (PR #73):** `packages/calypso` (`@fnndsc/calypso`)
scaffolded — zod message schemas (two direction-keyed unions), envelope schema
with a compile-time guard vs cumin's type, boundary validation (reject
structural, tolerate additive, never throw), `CONTRACT_VERSION` handshake.
Wired into root build after cumin, before chell. Uses **zod** (^3.23.8) +
ts-jest (CommonJS, like cumin). NOTE: lockfile must be regenerated under
node 22 (nvm use 22) to stay npm-ci-compatible on CI. Epic #64 now 1/7.

**#66 daemon MERGED (PR #74):** `CalypsoDaemon` (src/daemon/{server,token,engine}.ts)
— WebSocket host over ONE engine, loopback bind, random token (0600 file,
constant-time compare), attach handshake, serialized execute/complete → result.
KEY DECISION: daemon is **engine-agnostic** — accepts a structural `HostedEngine`
interface (chell's ChellEngine satisfies it), NOT importing chell, to avoid the
package cycle (chell will import calypso for the remote client). So calypso deps
stay cumin+zod+ws. The `chell --daemon` LAUNCHER (creates engine, installs a
suppressing/forwarding sink to kill daemon-stdout noise, forces color) is NOT
built yet — pairs with #68. Verified live: real chell engine over a socket
(pwd/whoami/completion correct, bad token refused). Epic #64 now 2/7.

**#67 session bus MERGED (PR #75):** CalypsoDaemon now tracks surfaces, broadcasts
each command's result envelopes to OTHER surfaces as `session {surface, envelope}`
(originator gets its correlated result only), and replays a bounded scrollback
ring (default 200, `scrollbackSize` option) to attaching surfaces; surfaces
dropped on close. Verified live: 2 surfaces on one daemon, command in A seen by B,
late-joiner gets scrollback. Live per-chunk OUTPUT streaming still deferred (needs
the launcher's forwarding sink, pairs with #68). Epic #64 now 3/7.

**#68 chell --remote/--daemon MERGED (PR #76):** first chell→calypso dep.
`RemoteEngine` (src/remote/remoteEngine.ts) implements ChellEngine over the wire
and delivers received envelopes to the sink like the local engine, so the REPL
is UNCHANGED. `chell --daemon` (src/daemon/launch.ts) hosts the connected engine
— forces color, discarding NullSink to quiet the daemon console, writes a 0600
discovery file (url+token) at tmpdir/chell-calypso-<user>.json. `chell --remote`
(src/remote/client.ts) reads discovery, attaches, runs REPL with a fixed prompt
(REPL gained a `promptText` option). Verified live: --daemon + --remote over pty
(attach/whoami/pwd/completion/forced-color) + 2-surface bus. Remote-client-home
question RESOLVED: inside chell. Epic #64 now 4/7.

**#69 interactivity — FULLY DONE & CLOSED.** All four bullets over the wire:
prompt (PR #77), completion (round-trips #66/#68), pushed prompt (PR #78), pipe
segments (PR #79). Surface now has `pipeSegments` capability + `pipeSegment(cmd,input)`
method; dispatch `pipe_execute` runs segment 1 in-engine then chains rest via
`surface.pipeSegment` (capability_require gate); daemon `pipe_current` broker routes
segments over `pipe`/`pipeResult` (base64) to the client; `chell --remote` runs them
locally via its own surface. Nothing spawns on the daemon. Verified live
(`whoami | grep -o rud` — daemon asked client to run grep).

**#70 remote local editing MERGED (PR #80):** Surface gained `localEdit(content,
extension)` method; CLI surface backs it with the temp-file+$EDITOR mechanics
MOVED out of the edit builtin; daemon `edit_current` broker routes edits over
`edit`/`editResult` messages to the executing surface; `chell --remote` opens the
client's editor. edit builtin now: fetch → surface.localEdit → upload. Resolves
the #57 local-edit FLAG deferral.

**#70 RENAMED/NARROWED (2026-07-09): structured progress over the daemon wire.**
Remaining work is only structured progress for `pull`/`upload`/`download`.
Key decision: progress is a first-class `progress` wire message emitted through
a semantic sink method such as `progress_write(event)`. Do NOT implement #70 by
forwarding cli-progress terminal frames or status text as
`output {channel:'status', chunk}`. Producers emit facts; renderers draw bars.
`pull` emits per-series events and maps `[NO LONK]` to `status:"unconfirmed"`;
CUBE materialization remains truth. `upload`/`download` expose optional progress
callbacks from chili helpers, adapted by chell into the active sink. Progress is
live-only, origin-surface-only, and excluded from pipes, redirects, capture, and
final envelopes. Full contract: `docs/structured-progress.md`.

Follow-ups split from #70: #82 live remote stdout/stderr streaming, and #83
terminal progress-bar parity after structured events are source of truth. NOTE:
full live verification of progress/upload needs CUBE re-auth + a scratch CUBE
path.

Sub-issues (dependency order): #65 ✅ (#73) → #66 ✅ (#74) → #67 ✅ (#75) →
#68 ✅ (#76) → #69 ✅ (#77/#78/#79) → #70 ✅ (#84) → #71 exit gate
(exemplars through the daemon + crash test + browser smoke). On board 26.

Open decision still to settle in-stage: interrupt semantics (what a cancel
keystroke does to a remote foreground command — compare the Jupyter protocol).
Remote-client-home was resolved: inside chell.
Board item ids: re-fetch with `gh project item-list 26 --owner FNNDSC
--format json` (same field/option ids as the stage-1 table below).

#59 progress builtins (CLOSED, no code, user-decided minimal/defer): assessment
found pipeline/pacs/store have no prompts and no progress (no-op); pull/upload/
download already run UNCAPTURED (correct on the terminal today). Routing
cli-progress frames through the status channel is the wrong shape for the real
consumer — a remote surface needs STRUCTURED progress (label/percent), not
terminal escape frames — and that consumer (the daemon) doesn't exist yet;
rerouting now also risks byte-identity (cli-progress renders differently off a
TTY) and upload/download progress lives in chili. DEFERRED to stage 2 (daemon):
"structured progress events over the daemon wire," shape defined by the
consumer. That shape is now documented in `docs/structured-progress.md`. Same
reasoning as the local-edit deferral.

Prompt capability (done, PR #61): `core/surface.ts` (Surface + SurfaceCapabilities
{hiddenInput,localEdit,tty} + capability_require + HeadlessSurface default),
`core/cliSurface.ts` (readline-backed, persistent on REPL rl + one-shot for
execute/script), `question.ts` delegates to the active surface, `edit` gates on
`localEdit`. Decision (user-confirmed): local-edit stays a declared FLAG — do
NOT move editor mechanics into the surface until the daemon stage adds a second
(remote) editor implementation. `connect` needed no change (password is an arg).

Error drain + fence (done, PR #62): cumin `errorStack` is now async-context
aware — `scope_run(fn)` (isolated stack via AsyncLocalStorage),
`checkpoint_mark()`/`checkpoint_drain(mark)`; all ops route through the active
stack (backward compatible). chell dispatch checkpoints before each command and
drains leftover messages into `envelope.errors`, escalating status to `error`
on a genuine drained error (this RETIRED the exit-delta status defect). The two
fire-and-forget background tasks that share the stack are fenced in `scope_run`:
`procTopology_warmup` (boot.ts) and `refreshInBackground` (vfs.ts). First
cumin change of the campaign — rebuild cumin before chell.

## Board tracking (HARBOR, project 26) — KEEP UPDATED as work lands

This stage is an epic on the FNNDSC HARBOR board. As each component is picked
up / opened / merged, move its board item so the epic's progress reflects
reality. Requires the `project` gh scope (`gh auth refresh -s project
--hostname github.com`).

Ticket ↔ component map (all in `FNNDSC/mise`, sub-issues of epic **#55**):

| Issue | Component | Type | Board item id | Current lane |
|-------|-----------|------|---------------|--------------|
| #55 | **Epic** (parent) | Epic | `PVTI_lADOABCveM4BU67AzgyDXBw` | In Progress |
| #56 | Engine facade (PR #54) | Feature | `PVTI_lADOABCveM4BU67AzgyDXC4` | Done (closed) |
| #57 | Prompt capability (component A, PR #61) | Feature | `PVTI_lADOABCveM4BU67AzgyDXDI` | Done (closed) |
| #58 | Per-command error capture + fencing (B, PR #62) | Technical Debt | `PVTI_lADOABCveM4BU67AzgyDXDY` | Done (closed) |
| #59 | Progress builtins (C) — assessed, deferred to stage 2 | Feature | `PVTI_lADOABCveM4BU67AzgyDXDg` | Done (closed) |
| #60 | Exit gate (D) | Task | `PVTI_lADOABCveM4BU67AzgyDXDk` | Backlog (NEXT) |

Board IDs for status edits:
- project id `PVT_kwDOABCveM4BU67A`, Status field id `PVTSSF_lADOABCveM4BU67AzhKhVC0`
- option ids: Backlog `a4550b60` · Todo `f75ad846` · In Progress `47fc9ee4`
  · In Review `dd1d72ab` · Done `98236657`

Transition recipe when you work a component (example uses #57 / its item id):
```
# start work → In Progress
gh project item-edit --project-id PVT_kwDOABCveM4BU67A \
  --id PVTI_lADOABCveM4BU67AzgyDXDI \
  --field-id PVTSSF_lADOABCveM4BU67AzhKhVC0 --single-select-option-id 47fc9ee4
# PR opened → In Review (option dd1d72ab)
# merged → Done + close the issue (Closes #57 in the PR body auto-closes it)
gh project item-edit ... --single-select-option-id 98236657
gh issue close 57 --repo FNNDSC/mise --reason completed
```
Best practice: put `Closes #57` in each PR body so merging auto-closes the
ticket; still set the board lane (closing an issue does not always move the
board item unless a project workflow is configured). When you promote the next
Backlog item to active, bump it Backlog→Todo. If board item ids ever go stale,
re-fetch: `gh project item-list 26 --owner FNNDSC --format json`.

## Context (read before coding)

- `docs/calypso.adoc` — governing spec; appendix = staged plan. Stage 1 =
  hostable engine + envelopes, exit criteria: green suites, green live
  exemplars, byte-identical CLI (except documented pipe-ANSI deviation).
- Auto-memory `calypso-stage1-state.md` (loads automatically) — campaign state.
- `/tmp/HANDOFF-calypso-stage1.md` — previous session's fuller context (may be
  gone; this file supersedes it).
- Style guide MANDATORY before writing source:
  `packages/cumin/TYPESCRIPT-STYLE-GUIDE.md` — RPN `object_verb` names,
  explicit types on ALL locals, JSDoc on everything exported + file headers.
- Hard rules: NO AI/Claude attribution in commits/PRs. No process jargon
  (Phase/Wave/stage) in source comments. One changeset per PR (chell minor,
  `.changeset/*.md`, see `gentle-engines-facade.md` in git history for format).
  Main is protected: PR + strict CI (node 22/24) + enforce_admins.
- **Review policy (user-decided 2026-07-07): review remaining PRs INLINE (self
  review while reading the diff) or `/code-review low` at most. Do NOT run the
  multi-agent review flow — it burned the monthly spend limit on PR #54.**

## Where the code now stands (post-#54)

- `packages/chell/src/core/engine.ts` — `ChellEngine` facade: `engine_create()`
  (session.init + VFS providers), `line_execute(line): Promise<CommandEnvelope[]>`
  (owns shell-escape → semicolons → redirect → pipe → single; one envelope per
  command; output delivered LIVE via sink), `line_complete()`, `stopOnError_set`,
  `command_handle` compat shim. Cumin imports TYPE-ONLY (test-mock constraint —
  same rule as sink.ts; a value import crashes unmocked jest suites).
- `core/dispatch.ts` — envelope seams: `command_dispatchEnvelope` (ENVELOPE_HANDLERS
  → run + `envelope_deliver`; unconverted handlers → UNCAPTURED via
  `handler_runDirect`, placeholder `{status, rendered:''}` from exit-code delta;
  chili fallback → capture bridge), `command_executeToEnvelope`,
  `redirect_execute`, `pipe_execute`, `shellCommand_execute` (returns exit code).
- `core/repl.ts` — thin host, takes engine; question registration + hidden-input
  `_writeToOutput` interception untouched (that's the next task's territory).
- `core/boot.ts` — all modes (execute/script/REPL) drive the engine.
- Tests: `tests/engine.test.ts` covers the facade; suite = 646 tests, thresholds
  60%/file stmts, 91% global functions — **always check `npm test` EXIT CODE**.

Exit-delta status defect (from PR #54): RESOLVED in PR #62 — dispatch now
escalates envelope status to `error` when a genuine error was drained from the
stack, independent of exit-code bookkeeping, so a later failing batch segment
no longer reads `ok`.

## Remaining components (in order; each a small PR)

### A. Prompt capability  (issue #57 · ~1 focused session — largest remaining piece)

Generalize `core/question.ts` registration into the surface-capability
interface (calypso.adoc "Interactivity is a declared surface capability"):
host provides an input broker (prompt request + hidden-input support) alongside
the output sink; surfaces declare capabilities; a builtin needing an absent
capability fails with a clear message rather than hanging.

- MUST preserve the single-readline discipline: repl.ts intercepts readline's
  `_writeToOutput` for hidden input — one readline interface on stdin, no raw
  mode, no second interface (comment in repl.ts explains; stdin leaks
  otherwise).
- Unblocks the 4 interactive holdouts: `plugin` (add-flow admin prompt —
  deliberately UNbridged; registry comment in dispatch.ts explains), `connect`,
  `prompt`, `edit` ($EDITOR → local-edit capability; engine fetches content,
  surface edits, engine uploads on save).
- Verification: pty-driven interactive tests are required (piped stdin doesn't
  reach the REPL — pre-existing). Recipe that works:
  `{ sleep 20; printf 'cmd\r'; sleep 6; printf 'exit\r'; } | script -qec
  "node dist/index.js --ascii-boot --no-prefetch-feeds --no-prefetch-plugins
  --no-prefetch-jobs" /tmp/out.txt`

### B. Checkpoint-drain + fence  (issue #58 · ~half session)

Dispatch checkpoints errorStack before each command, drains anything pushed
above the checkpoint into `envelope.errors` after. Hazard (calypso.adoc wire
contract, "verified, not assumed"): background work pushes/pops the same stack
outside command boundaries — `lib/prefetch.ts` and `lib/vfs/vfs.ts` async
push/pop — corrupting drain windows. Fence background stack traffic during
command execution or attribute it. Natural seam: `command_dispatchEnvelope` /
`command_executeToEnvelope`. Also fix the exit-delta status defect here (drain
gives real per-command failure signal).

### C. Progress builtins  (issue #70 · structured-progress slice)

`pull`/`upload`/`download` currently render terminal progress directly. Route
progress facts through the semantic progress sink and CALYPSO `progress` wire
message; do not route terminal frames through `status_write` or
`output {channel:'status'}`. `pull` constructs per-series events in chell from
`SeriesPullTask`/LONK state. `upload`/`download` expose optional callbacks from
chili helpers and chell adapts them into `sink_get().progress_write(...)`.
CAUTION: live verification of upload/download MUST use a scratch CUBE path,
never the user's real storage (no rm/upload/mkdir on user paths).

### D. Stage-1 exit gate  (issue #60 · ~small, mostly wall-clock)

Full suites green (EXIT CODE), live exemplars green (memory
`live-e2e-exemplars`: chell/exemplars harness, e2e.yml), CLI byte-identical
sweep except the documented pipe-ANSI deviation. Then update memory + this
file; consider a calypso.adoc status note.

## Working method that held (keep following it)

- Per-PR live byte-verification: build, run `node packages/chell/dist/index.js
  -c '<cmd>'` against the live radstar@ekanite session; baseline via
  `git stash -u` → rebuild → capture → `git stash pop` → rebuild → `cmp`.
  Normalize `(node:PID)` in stderr; timing lines compared structurally.
  Battery from PR #54: pwd, whoami, ls, ls /bin, `pwd; whoami`,
  `ls /bin | head -3`, redirect, `!echo`, help, `ls --help`, `frobnicate`,
  `timing on; pwd; timing off`, `du /bin`.
- Avoid `cd` in live tests or restore the user's cwd (deep /net/pacs/... path
  persisted in their context).
- Rebuild cumin before chell if cumin changes (chell consumes dist).
- Direct jest: `NODE_OPTIONS='--experimental-vm-modules
  --disable-warning=ExperimentalWarning' npx jest --forceExit <file>`.
- `gh pr checks <N>` exit 8 = pending. Merge: `gh pr merge <N> --merge`;
  `gh pr update-branch <N>` first if BEHIND. If lockfile is touched, regen with
  CI's npm version (memory `npm-lockfile-ci-version`).
- Session task list: #1 facade completed; #2 prompt capability, #3 drain+fence,
  #4 progress builtins, #5 exit gate pending. Task lists do NOT persist across
  sessions — recreate from this file if empty.
