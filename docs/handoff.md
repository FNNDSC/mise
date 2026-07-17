# Active project handoff

- Last updated: 2026-07-16
- Last verified against `main`: `76967f3`
- Working branch: `fix/recovered-shell-followups`
- Current milestone: persistent `/proc` checkpoints and recovered shell follow-ups complete locally
- Next action: push the feature branch, open a PR, and let strict Node 22/24 CI verify it

## Current truth

- **mise is the framework.** The dependency direction remains `cumin → salsa →
  chili → brasa → calypso → chell`: brasa is the hostable engine, calypso hosts
  one engine per session daemon, and chell is the local/remote CLI surface.
- Stage 1 (hostable engine and structured envelopes) and Stage 2 (CALYPSO daemon
  plus sibling surfaces) are complete. Their campaign record is archived in
  [history/calypso-stage1-stage2.md](history/calypso-stage1-stage2.md).
- Tier-1 identity-keyed daemons are complete and published. One machine can run
  isolated daemons per `<user>@<url>` identity; see
  [session-supervisor.adoc](session-supervisor.adoc). Tier-2 `porter` remains
  deferred until the web surface establishes its network/auth perimeter.
- CUBE remains durable workflow truth. Daemon scrollback, progress, and
  conversational state are presentation or ephemeral context.
- Stage 3 natural-language intent remains undesigned. Do not create its epic or
  choose a provider without a separate design grill.

## Recently completed

The local feature branch contains five reviewed units on top of release-state
`main`; none has been pushed:

- `8345545` persists an identity-scoped, mode-`0600` `/proc` topology
  checkpoint. Daemon startup validates restored feed visibility against CUBE
  before exposure, serves the restored graph while reconciling in the
  background, atomically replaces successful checkpoints, and quarantines
  restored data when visibility validation fails. `proc stat` distinguishes
  restored/reconciling state, while the prompt reports sweep progress;
  `proc refresh` remains the explicit authoritative refresh. Direct plugin and
  pipeline executions update the cache. CUBE remains authoritative.
- `f1a1f1c` makes wildcard-expanded virtual leaves such as `/bin/pl-*` render
  as entries instead of being treated as directories. Directory operands keep
  their existing descent behavior.
- `fd7379d` keeps remote hidden-input labels visible after readline activates
  and names the registration prompts `Admin username` and `Admin password`.
- `72a0ae5` returns dynamic plugin inspection through command envelopes, gives
  `help <versioned-plugin>` and `<versioned-plugin> --help` one renderer, and
  fixes `--parameters`/`--readme` across remote, pipe, and redirect surfaces.
  README discovery prefers `public_repo`, retains source-format metadata,
  renders Markdown, and preserves reStructuredText without passing it through
  the Markdown renderer.
- The `id` builtin reports the authenticated CUBE user as Unix-style
  `uid=N(name) gid=N(name)`. CUBE has no primary-group field, so the GID mirrors
  the UID consistently with ChELL's `/etc/passwd` projection.

PR #140 (`e630f79`) made registered CUBE pipeline templates visible through the
same diagram machinery already used for instantiated feed DAGs:

- `pipeline diagram <id|name|search>` draws the authored pipings as a shallow
  tree. `--withargs` appends non-null stored plugin defaults; `--signalflow`
  emits SignalFlow YAML.
- Pipelines exposed through `/bin` accept `--diagram`, optionally followed by
  `--withargs` or `--signalflow`; bare `--signalflow` is the direct SignalFlow
  alias. They return the same structured envelope as the explicit command.
- Pipeline pipings are never collapsed: every authored title/default set stays
  visible. Feed collapse remains unchanged.
- `feed diagram [<specifier>]` is an exact shallow alias of `feed tree`.
  Feed graph commands accept numeric IDs, `feed_N`, exact titles, and unique
  title searches. Inside any `feed_N` path—including `/proc/jobs/feed_N`—the
  specifier can be omitted.
- Feed and pipeline adapters converge on one nested diagram-node model, one
  shallow connector walk, and one SignalFlow emitter. There is no duplicate
  join or rendering implementation.

The detailed model and rendering rationale lives in
[feed-dag-viewer.adoc](feed-dag-viewer.adoc).

PR #142 (`71a6cd4`) completed the executable and daemon follow-up:

- Dynamic pipeline executables provide contextual `--help`, and bare
  `<pipeline> --signalflow` routes to the pipeline SignalFlow emitter.
- Remote pipe-segment failures propagate back to the engine without killing the
  interactive client. Final redirection stays on the originating surface, so
  shell expansion and local paths have local meaning.
- Interactive and daemon hosts share startup warming. Daemon mode reports
  Plugins, Pipelines, Feeds, Public, and Jobs status, then reports `Engine Ready`
  before binding and publishing its berth. A failed warm-up is reported
  explicitly; the daemon still starts and loads that data lazily.

PR #144 (`6f0833a`) completed the operational follow-up:

- `/proc` indexes the union of owned/shared and public CUBE feeds, deduplicates
  overlaps, retains ownership/public metadata, and tracks the deterministic
  plugin-instance total during topology warm-up.
- Prompt progress renders `N/M f%` without presenting 100% while work is active.
  `proc stat` reports exclusive U/P/S feed scope and explicit topology lifecycle.
- Global `proc` queries refuse partial results while warming or after failure;
  `--force` joins the existing sweep without starting another. Targeted numeric
  lookup and navigation remain available.
- A full `proc refresh` resets the old topology lifecycle and starts exactly one
  replacement sweep. Failed sweeps clear prompt progress, and daemon output
  reports the eventual `Topology` ready/failure result.
- `chell --remote -c '<command>'` now executes once through the attached daemon,
  returns the remote status, closes the transport, and exits instead of entering
  or leaving behind an interactive attachment.

## Verification state

- On `fix/recovered-shell-followups`, a clean `make taco` used pinned npm
  `10.9.8`, rebuilt all packages in dependency order, and passed every
  workspace suite. After review corrections, the full root suite passes with
  Cumin 612, Salsa 370, Chili 373, Brasa 702, Calypso 81, and ChELL 102 tests.
  npm reported zero vulnerabilities. The synthetic 7,009-job
  checkpoint remains approximately 790 KB and measured 9 ms save/9 ms restore
  on this machine. No live CUBE state was mutated.
- The pipeline feature passed focused and full cumin, salsa, and brasa suites,
  including path extraction, feed resolution, shallow/SignalFlow output,
  pipeline arguments/joins, and `/bin` envelope equivalence. A clean `make taco`
  completed successfully before PR #140 merged.
- PR #142 added coverage for executable utility routing, contextual help,
  remote pipe failures, surface-owned redirection, shared startup warming, and
  daemon publication ordering. Strict Node 22/24 CI passed before merge.
- PR #144 adds capped-pagination, public-feed union,
  warm-up lifecycle/failure, prompt progress, command gating, and remote
  one-shot regression coverage. The dependency-ordered build, full workspace
  test suite (including permitted loopback daemon tests), and lint all pass;
  lint reports only four pre-existing unused-disable warnings. Independent
  standards and behavior audits report no remaining findings.
- Package builds are run in dependency order; parallel downstream builds race
  workspace declaration regeneration and are not valid verification.
- Before PR #140 merged, public read-only CUBE resources verified pipeline 244's
  live pipings/default-parameter shape, including `pl-topologicalcopy` with
  `plugininstances = "1445,1447,1450"` (stored piping IDs). Subsequent operator
  invocations exercised authenticated pipeline executables on ekanite. No CUBE
  state was changed by the verification.

## Published release state

Published from Version Packages PR #145 (`c79731f`), with the Calypso retry
completed after release-infrastructure PR #146 (`3efbdae`):

- `@fnndsc/chell` 5.2.3
- `@fnndsc/calypso` 0.4.3
- `@fnndsc/brasa` 0.9.2
- `@fnndsc/chili` 3.6.1
- `@fnndsc/cumin` 3.8.1
- `@fnndsc/salsa` 3.5.1

The first publish run released five packages but Calypso's concurrent
`prepublishOnly` rebuild raced Cumin's declaration rebuild. PR #146 made the
root dependency-ordered build authoritative and changed both package hooks to
non-mutating artifact checks; the retry published Calypso 0.4.3. npm versions,
GitHub releases, Binaries, and post-merge Node 22/24 CI are verified green.

## Follow-ups and risks

- After reconciliation reaches current state, analyses created by another
  client require `proc refresh` or daemon restart; periodic external-change
  polling remains deliberately out of scope.
- `packages/calypso/src/daemon/discovery.ts` is legacy single-file discovery;
  chell no longer uses it, but removal is separate cleanup.
- [#107](https://github.com/FNNDSC/mise/issues/107): restore the CALYPSO browser
  smoke as a CI gate.
- [#94](https://github.com/FNNDSC/mise/issues/94): materialize structured `pull`
  progress proof; still constrained by the test-owned PACS fixture policy.
- Remote interrupt/cancellation semantics remain undesigned.

## Freshness contract

Every architectural, release, or project-state PR must update this file. Update
the verified main commit, date, current milestone, release state, and next
action. Routine dependency and typo-only PRs need not touch it.
