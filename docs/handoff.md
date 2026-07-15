# Active project handoff

- Last updated: 2026-07-15
- Last verified against `main`: `d7c332b`
- Working branch: `agent/pipeline-diagram`
- Current milestone: pipeline-template diagrams and contextual feed diagrams
- Next action: commit the reviewed implementation; open the feature PR when requested

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

## Current branch

This branch makes registered CUBE pipeline templates visible through the same
diagram machinery already used for instantiated feed DAGs:

- `pipeline diagram <id|name|search>` draws the authored pipings as a shallow
  tree. `--withargs` appends non-null stored plugin defaults; `--signalflow`
  emits SignalFlow YAML.
- Pipelines exposed through `/bin` accept `--diagram`, optionally followed by
  `--withargs` or `--signalflow`, and return the same structured envelope as the
  explicit command.
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

## Verification state

- Focused cumin and brasa tests are green, including path extraction, feed
  resolution, shallow/SignalFlow output, pipeline arguments/joins, and `/bin`
  envelope equivalence.
- A clean `make taco` completed successfully. After review fixes, the affected
  full suites also pass: cumin 605 tests, salsa 362 tests, and brasa 660 tests;
  cumin, salsa, and brasa compile in dependency order.
- Package builds are run in dependency order; parallel downstream builds race
  workspace declaration regeneration and are not valid verification.
- The configured ekanite token is expired, so an authenticated ChELL invocation
  could not run. Public read-only CUBE resources verified pipeline 244's live
  pipings/default-parameter shape, including `pl-topologicalcopy` with
  `plugininstances = "1445,1447,1450"` (stored piping IDs). No CUBE state was
  changed.

## Published release state

Published from `d7c332b`:

- `@fnndsc/chell` 5.2.0
- `@fnndsc/calypso` 0.4.0
- `@fnndsc/brasa` 0.8.0
- `@fnndsc/chili` 3.6.0
- `@fnndsc/cumin` 3.7.0
- `@fnndsc/salsa` 3.4.0

This branch carries a changeset for minor releases of cumin, salsa, and brasa.
The normal Version Packages PR and strict Node 22/24 checks apply after merge.

## Follow-ups and risks

- The authenticated live command proof should be repeated after reconnecting to
  ekanite; the public endpoint proof validates wire shape but not local stored
  authentication/session configuration.
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
