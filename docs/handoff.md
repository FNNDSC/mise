# Active project handoff

- Last updated: 2026-07-10
- Last verified against `main`: `3bf26e7`
- Working branch: `agent/stage2-operational-closure`
- Current milestone: Stage 2 operational closure
- Current issue: [#90](https://github.com/FNNDSC/mise/issues/90)
- Next action: merge #90, then make scheduled PACS coverage non-destructive in #91

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

Issue #90 separates two independent proofs:

- An actual headless browser attaches to a local `CalypsoDaemon` backed by a
  stub `HostedEngine`. This belongs in ordinary required CI and needs no CUBE
  credentials.
- `05_calypsoDaemon` exercises a real daemon and restart against live CUBE. It
  belongs in the scheduled/manual, non-release-blocking E2E workflow and no
  longer launches Chromium.

This branch also records the recursive expansion **CALYPSO Accepts Language,
Yielding Permitted Shell Operations** in the canonical documentation.

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

- [#91](https://github.com/FNNDSC/mise/issues/91): scheduled PACS coverage must
  stop deleting/restoring series that existed before the test. Scheduled runs
  may clean up only test-owned artifacts.
- [#92](https://github.com/FNNDSC/mise/issues/92): one manual remote PTY run
  appeared to display an `ls` listing twice. This is unconfirmed. Reproduce and
  classify it; do not treat a hypothesis as a known defect.
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
