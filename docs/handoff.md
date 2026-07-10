# Active project handoff

- Last updated: 2026-07-10
- Last verified against `main`: `fc9093a`
- Working branch: `agent/classify-remote-output`
- Current milestone: Stage 2 operational closure
- Current issue: [#92](https://github.com/FNNDSC/mise/issues/92)
- Next action: merge #92, then verify and merge the changesets release PR #45

## Current truth

- Stage 1, the hostable chell engine and structured command envelope, is
  complete. Epic [#55](https://github.com/FNNDSC/mise/issues/55) is closed.
- Stage 2, the single-operator CALYPSO daemon and sibling-surface topology, is
  complete. Epic [#64](https://github.com/FNNDSC/mise/issues/64) is closed.
- The Stage 2 exit gate passed locally against the configured live CUBE:
  daemon execution, safe filesystem materialization, `/proc` inspection,
  restart/context rehydration, and an actual-browser attach smoke.
- Stage 3, natural-language intent resolution, has not started. It has no epic,
  provider selection, adapter, compiler, or guard implementation. Run a
  separate design grill before creating that work.
- CUBE is durable truth. Daemon scrollback, progress, and conversational state
  are presentation or ephemeral context, never workflow authority.

## Active work

Issue #90 separated two independent proofs and merged in PR #93:

- An actual headless browser attaches to a local `CalypsoDaemon` backed by a
  stub `HostedEngine`. This belongs in ordinary required CI and needs no CUBE
  credentials.
- `05_calypsoDaemon` exercises a real daemon and restart against live CUBE. It
  belongs in the scheduled/manual, non-release-blocking E2E workflow and no
  longer launches Chromium.

Issue #91 made scheduled PACS validation non-destructive and merged in PR #95. Exemplar 04 now
verifies pre-existing CUBE materialization without retrieving, deleting, or
restoring it. It retrieves only a series proven absent at the start of the run,
and registers cleanup for that test-created folder before retrieval begins.
The live preserve path passed 4/4 against the configured CUBE: the existing
one-file series remained untouched and only the run's PACSQuery was deleted.

The recursive expansion **CALYPSO Accepts Language, Yielding Permitted Shell
Operations** is now canonical.

## Release state

Changesets release PR [#45](https://github.com/FNNDSC/mise/pull/45) is open and
intends to publish:

- `@fnndsc/calypso` 0.2.0
- `@fnndsc/chell` 4.4.0
- `@fnndsc/cumin` 3.5.0

GitHub currently marks that PR blocked and it has not run the normal Node 22/24
CI checks. The CI workflow gains a manual trigger in #90 so the release branch
can be verified explicitly after this PR merges. Live CUBE remains informative,
not a package-release gate.

## Follow-ups and risks

- [#91](https://github.com/FNNDSC/mise/issues/91): closed by PR #95. Scheduled
  PACS coverage cleans up only materialization created by the current run.
- [#92](https://github.com/FNNDSC/mise/issues/92): one manual remote PTY run
  appeared to display an `ls` listing twice. The observation remains
  unconfirmed: the interactive reproduction was obscured by terminal-image
  redraw traffic. The transport has suppressed repeated final-envelope text
  since PR #85. Focused client coverage proves a streamed channel is delivered
  once, while daemon coverage independently proves live output goes only to the
  origin surface and sibling surfaces receive the session envelope.
- [#94](https://github.com/FNNDSC/mise/issues/94): materialize the missing live
  proof for structured `pull` progress and LONK/CUBE truth. Exemplar 04 has
  always used lower-level PACS helpers, so it does not currently observe chell
  progress events. The proof requires a disposable, test-owned PACS fixture and
  is blocked by #91's ownership policy.
- The repository's live E2E job skips when `CUBE_*` secrets are absent. A green
  skipped job is not evidence that live exemplars ran; inspect step outcomes.
- Remote interrupt/cancellation semantics remain undesigned and are not part of
  the completed Stage 2 exit criteria.

The detailed Stage 1/2 campaign record, including historical implementation
notes and live-test observations, is preserved in
[history/calypso-stage1-stage2.md](history/calypso-stage1-stage2.md).

## Freshness contract

Every architectural, release, or project-state PR must update this file. Update
the verified main commit, date, current milestone, release state, and next
action. Routine dependency and typo-only PRs need not touch it. When an epic
closes, archive its detailed campaign record under `docs/history/` and reset
this file to the new current state. The PR author is responsible for semantic
freshness; CI cannot determine whether a handoff is truthful.
