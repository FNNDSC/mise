# Active project handoff

- Last updated: 2026-07-13
- Last verified against `main`: `79729c9`
- Working branch: `agent/date-cal-builtins`
- Current milestone: engine extraction shipped; Stages 1 & 2 complete and released
- Next action: design grill for Stage 3 (natural-language intent) before opening an epic

## Current truth

- **mise is the framework.** The sandwich is `cumin → salsa → chili → brasa →
  calypso → chell`: cumin/salsa/chili are the layered API + resource logic,
  **brasa** is the hostable engine (kernel) — parser, dispatch, pipes, builtins,
  session, output, with no terminal of its own — **calypso** is the session
  daemon that hosts a brasa engine and serves it to surfaces over a WebSocket,
  and **chell** is the CLI surface (a local shell drives brasa in-process; a
  remote client drives it over calypso).
- Stage 1 (hostable engine + structured command envelope) is complete; epic
  [#55](https://github.com/FNNDSC/mise/issues/55) closed.
- Stage 2 (single-operator CALYPSO daemon + sibling-surface topology) is
  complete; epic [#64](https://github.com/FNNDSC/mise/issues/64) closed.
- The **brasa engine extraction** (chell engine → hostable kernel) is complete
  and released; epic [#105](https://github.com/FNNDSC/mise/issues/105). The
  engine no longer intercepts the console anywhere — all command output travels
  in an envelope through a swappable sink (a `StdoutSink` locally, a daemon sink
  that routes to the attached surface).
- Stage 3, natural-language intent resolution, has not started. It has no epic,
  provider selection, adapter, compiler, or guard. Run a separate design grill
  before creating that work.
- CUBE is durable truth. Daemon scrollback, progress, and conversational state
  are presentation or ephemeral context, never workflow authority.

## Recently shipped

Beyond the Stage 1/2 campaign (archived under `docs/history/`), recent surface
and engine work:

- **Version reporting fix + `chell --info`.** `chell --version` had reported
  brasa's version in place of chell's; it now resolves every package by name and
  reports the full stack from a single source of truth in brasa (`stackInfo_get`).
  `--info` prints a role-grouped table (surfaces / engine / layers).
- **chili delegation hardened.** chili registers its file-group and
  plugin-context commands without resolving any ChRIS context (controllers are
  lazy, created only when an action runs), so an unrelated command in a pure-VFS
  folder no longer stalls or dumps a context-init error wall. chili exports a
  cheap `commandNames_get()`; brasa emits the "delegating to chili" notice before
  running chili and reports `command not found` for a command chili does not know
  instead of delegating.
- **`--help` routed through the sink.** The `<cmd> --help` path printed via
  `console.log`, which on a daemon leaked to the daemon's terminal (and returned
  an empty envelope). Help now travels in an envelope through the sink.
- **New builtins:** `fortune` (bundled classic fortune cookies), and `date` /
  `cal` (UNIX-style, pure computation). All self-contained — no host binary, no
  subprocess — so they behave the same local, over a daemon, and in the binary.

## Release state

Published on npm (`latest`):

- `@fnndsc/chell` 5.1.1
- `@fnndsc/calypso` 0.3.4
- `@fnndsc/brasa` 0.5.0
- `@fnndsc/chili` 3.6.0
- `@fnndsc/cumin` 3.5.0
- `@fnndsc/salsa` 3.2.6

This PR adds the `date`/`cal` builtins (a `@fnndsc/brasa` minor); it publishes
in the next Version Packages release.

**Release process note.** The changesets "Version Packages" PR is created by the
bot with `GITHUB_TOKEN`, so the required Node 22/24 checks do not auto-run and
GitHub marks it blocked. Push one empty commit to `changeset-release/main`
(`git commit --allow-empty -m "ci: trigger required checks on the version-packages PR"`)
to trigger the checks under a real user, then merge to publish. Live CUBE remains
informative, not a package-release gate.

## Follow-ups and risks

- [#107](https://github.com/FNNDSC/mise/issues/107): harden the CALYPSO
  real-browser smoke so it can gate CI again (currently skipped in CI; runs
  local/nightly).
- [#94](https://github.com/FNNDSC/mise/issues/94): materialize the missing live
  proof for structured `pull` progress and LONK/CUBE truth; blocked by the
  test-owned PACS fixture policy.
- The live E2E job skips when `CUBE_*` secrets are absent. A green skipped job is
  not evidence that live exemplars ran; inspect step outcomes.
- Remote interrupt/cancellation semantics remain undesigned and are not part of
  the completed Stage 2 exit criteria.
- Stage 3 (natural-language intent) is entirely undesigned — no provider,
  adapter, compiler, or guard.

The detailed Stage 1/2 campaign record is preserved in
[history/calypso-stage1-stage2.md](history/calypso-stage1-stage2.md).

## Freshness contract

Every architectural, release, or project-state PR must update this file. Update
the verified main commit, date, current milestone, release state, and next
action. Routine dependency and typo-only PRs need not touch it. When an epic
closes, archive its detailed campaign record under `docs/history/` and reset
this file to the new current state. The PR author is responsible for semantic
freshness; CI cannot determine whether a handoff is truthful.
