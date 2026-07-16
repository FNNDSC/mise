# Active project handoff

- Last updated: 2026-07-16
- Last verified against `main`: `3efbdae`
- Working branch: `main`
- Current milestone: deterministic `/proc` warm-up and remote one-shot release complete
- Next action: start a clean session and select the next milestone

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
