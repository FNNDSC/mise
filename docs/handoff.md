# Active project handoff

- Last updated: 2026-07-18
- Last verified against `main`: `8f5bc90`
- Working branch: `feat/pipeline-invocation-overlays`
- Current milestone: pipeline runtime overlays and PACS plugin/pipeline
  attachment are implemented, reviewed, and fully validated
- Next action: land the implementation branch

## Current truth

- **mise is the framework.** The dependency direction remains `cumin → salsa →
  chili → brasa → calypso → chell`: Brasa is the hostable engine, Calypso hosts
  one engine per session daemon, and ChELL is the local/remote CLI surface.
- CUBE is durable workflow truth. Daemon scrollback, progress, prompt state, and
  identity-scoped `/proc` checkpoints are recoverable presentation state.
- Tier-1 identity-keyed daemons are complete. Tier-2 cloud hosting remains
  deferred until the web surface establishes its network and authentication
  perimeter. The persistence rationale is in
  [session-supervisor.adoc](session-supervisor.adoc#cloud-persistence-posture).
- Stage 3 natural-language intent remains undesigned. Do not create its epic or
  select a provider without a separate design session.
- `codex.resume` is an unrelated untracked local file. Do not add, edit, or
  remove it.

## PACS workflow now on `main`

PR [#153](https://github.com/FNNDSC/mise/pull/153), squash commit `645026e`,
landed with successful Node 22 and Node 24 CI.

`pacs pull <selection...> --new-feed "TITLE"` now:

1. resolves query, study, and/or series operands into a precise series set;
2. retrieves every selected series and waits for completion;
3. resolves each series to its concrete `/SERVICES/PACS/...` CUBE directory;
4. creates exactly one named Feed rooted at `pl-dircopy` over those directories;
5. prints the Feed ID, root job ID, input series count, and Feed path.

Ordinary `pacs pull` remains retrieve-only. Feed creation is all-or-nothing:
invalid/empty operands, partial retrieval, or unresolved CUBE paths prevent Feed
creation while leaving already retrieved files in storage. `--new-feed` is
incompatible with `--nowait`.

The authoritative behavior and architecture are documented in
[packages/chell/docs/pacsqr.adoc](../packages/chell/docs/pacsqr.adoc). The root
README and ChELL README provide the short user-facing form, the ChELL command
reference records the command grammar, and ChELL's domain glossary defines PACS
Selection and PACS Analysis Attachment.

## PACS analysis attachment

The agreed command surface is:

```shell
pacs pull <selection...> \
  --new-feed "Brain MRI" \
  --plugin pl-dcm2niix-v1.2.0 \
  -- --outputdir nii

pacs pull <selection...> \
  --new-feed "Brain MRI" \
  --pipeline brain-preprocessing \
  -- \
  --registration.dof 12 \
  --segmentation.threshold 0.4
```

Implemented contract:

- `--plugin` and `--pipeline` are mutually exclusive.
- Both require `--new-feed`; neither implicitly creates a Feed.
- Resolve selectors exactly as direct plugin execution and `pipeline run` do.
- Forward everything after `--` through the selected command's existing
  invocation semantics. Do not introduce another parameter grammar.
- Pipeline invocation binds runtime values as
  `--<node>.<parameter> <value>` or through `--paramFile <file>`. The file is a
  sparse overlay over the parameter-bearing portion of `plugin_tree`; it never
  registers a new Pipeline. See
  [feed-dag-viewer.adoc](feed-dag-viewer.adoc#pipeline-parameter-binding).
- Execute in stages: retrieve → resolve → create Feed/root → attach analysis.
- Any failure before attachment prevents attachment.
- If attachment fails, retain the valid Feed, return nonzero, and print enough
  Feed/root identity for manual continuation. Do not roll back the Feed.
- On success, print the existing Feed/root summary plus the created plugin
  instance or workflow identity.
- Runtime help advertises the implemented attachment grammar.

Implementation seams:

- `packages/brasa/src/builtins/fs/pull.args.ts` — parse the mutually exclusive
  attachment choice and the `--` payload.
- `packages/brasa/src/builtins/fs/pull.ts` — stage attachment after successful
  `feedCreation_fromPaths`.
- `packages/brasa/src/builtins/feedCreation.ts` — shared Feed creation result.
- `packages/brasa/src/builtins/pluginExecute.ts` — reuse plugin selector and
  invocation behavior.
- `packages/brasa/src/builtins/res/pipeline.ts` and `pipeline.args.ts` — reuse
  pipeline resolution and execution behavior.
- `packages/brasa/tests/pull-builtin.test.ts` — parser, lifecycle, failure, and
  output coverage.

Pipeline attachment reuses `builtin_pipeline`; plugin attachment reuses Salsa's
plugin execution seam and the shared Brasa token binder.

ChELL remains a ChRIS domain shell rather than a general programming language.
It owns one configured platform operation; Bash, Python, or another caller owns
loops, conditionals, concurrency, and repetition over input or parameter files.
Do not add pipeline/plugin `--sweep` flags or ChELL control-flow syntax for that
general orchestration. The rationale and composability obligations are in
[intent-kernel.adoc](intent-kernel.adoc#shell-boundary).

## Other recently completed work

- PR #148: persistent identity-scoped `/proc` checkpoints, complete CUBE group
  reporting in `id`, remote-input fixes, and executable inspection recovery.
- PR #150: `~` prompt abbreviation and a high-contrast Powerlevel10k-inspired
  Font Awesome prompt palette.
- PR #151: prompt order `PACS | URL | user | path | proc`, explicit cold/cache
  refresh lifecycle clues, and cloud-persistence guidance.
- PR #152: opt-in `cat --highlight [language]` syntax highlighting for Python
  and other common formats, with ANSI-free pipes and redirects.
- PR #153: PACS selection-to-Feed creation described above.
- PR #154: authoritative PACS attachment design and ChELL 5.2.8 documentation.
- PR #155: pipeline parameter-binding/file-overlay contract and the Unix boundary
  that keeps general programming in the calling shell; ChELL 5.2.9 documentation.

Historical Stage 1/2 and earlier delivery detail is archived in
[history/calypso-stage1-stage2.md](history/calypso-stage1-stage2.md) and GitHub's
merged PR record; keep this active handoff focused on current truth.

## Release and verification state

Source versions on this branch are ChELL 5.2.10, Calypso 0.4.4, Brasa 0.9.6,
Chili 3.6.1, Cumin 3.8.4, and Salsa 3.5.3. The latest npm-published
versions verified on 2026-07-18 remain ChELL 5.2.3, Calypso 0.4.3, Brasa 0.9.2,
Chili 3.6.1, Cumin 3.8.1, and Salsa 3.5.1.

The bumped packages have matching changelog and lockfile metadata and remain
unpublished to npm until the next release workflow.

The implementation branch passes the dependency-ordered workspace build, the
full workspace test suite and coverage gates, seam/test lint gates, documentation
rendering, and independent standards/spec review.

PR #155 passed Node 22/24 CI and GitGuardian. Package builds
must remain dependency ordered; parallel downstream builds can race workspace
declaration regeneration.

Every touched package requires a version bump and changelog entry. Use pinned
npm 10.9.8 when regenerating the root lockfile to avoid unrelated npm 11 churn.

## Follow-ups and risks

- `pacs pull` still fires a new retrieve for a SeriesInstanceUID already present
  in CFS. A separate idempotency increment should reuse complete series, retrieve
  only missing/incomplete data, and provide an explicit force-refresh option.
- PACS progress proof issue
  [#94](https://github.com/FNNDSC/mise/issues/94) remains constrained by the
  test-owned PACS fixture policy.
- After `/proc` reconciliation reaches current state, analyses created by
  another client require `proc refresh` or daemon restart; periodic polling is
  deliberately out of scope.
- `packages/calypso/src/daemon/discovery.ts` is legacy single-file discovery;
  ChELL no longer uses it, but removal is separate cleanup.
- CALYPSO browser-smoke issue
  [#107](https://github.com/FNNDSC/mise/issues/107) remains open.
- Remote interrupt/cancellation semantics remain undesigned.

## Freshness contract

Every architectural, release, or project-state PR must update this file. Update
the verified main commit, date, milestone, release state, and next action.
Routine dependency and typo-only PRs need not touch it.
