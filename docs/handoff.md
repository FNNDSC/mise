# Active project handoff

- Last updated: 2026-07-13
- Last verified against `main`: `96bb6d3`
- Working branch: none — `main` is clean, **0 open PRs**
- Current milestone: engine fully sans-I/O + published; docs reframed around the intent kernel
- Next action: **envelope Phase 2** — give every command a typed `model` (see `envelope-model.adoc`)

## Orientation (read this first if you are new)

**mise is the framework whose core is an _intent kernel_ for ChRIS.** ChRIS is a
cloud platform for scientific/medical-image analysis behind a Collection+JSON
REST API; mise turns that API into a driveable system. **Do not call mise "a
CLI"** — that conflates the framework with one surface. Taxonomy:

- `cumin` — the only layer that touches `@fnndsc/chrisapi` (the CJ adapter).
- `salsa` — intent assembly over cumin (the VFS + high-level operations).
- `chili` — typed commands + view renderers, and a scriptable CLI.
- **`brasa`** — the **intent kernel** (engine): parse → dispatch → execute → `CommandEnvelope`. No terminal of its own.
- **`chell`** — the **shell surface** you run (REPL, rendering, `--remote` client).
- **`calypso`** — the **daemon** that hosts a brasa engine over WebSocket for attached surfaces.

A web console and an LLM agent are designed peer surfaces on the same kernel.
Scale: ~42k lines TS / 289 files / 6 packages / ~2k tests. Not small.

Deeper: `docs/history.adoc` (the story), `docs/intent-kernel.adoc` (client
reference), `docs/envelope-model.adoc` (the Phase-2 contract),
`docs/gettingStarted.adoc` (install/connect/run), `docs/calypso.adoc` (daemon +
wire + forward doctrine). Persistent context: the memory index at
`~/.claude/projects/-home-rudolph-src-mise/memory/MEMORY.md` (start with
`mise-intent-kernel-docs.md` and `brasa-engine-split-decision.md`).

## Current truth

- **The engine is fully sans-I/O.** Both console monkeypatches are gone:
  `printingHandler_wrap` (per-command, removed with #104) and the pipe-path
  `output_capture` (removed with #110). Every command returns a `CommandEnvelope`;
  no layer below a surface prints. chili has its own output seam
  (`screen/output.ts`) with a default that delegates to the console, so its
  standalone CLI is unchanged.
- **Published (2026-07-13), verified live on npm:** `brasa` 0.3.0 · `chili` 3.5.0
  · `calypso` 0.3.2 · `chell` 5.0.2 · `cumin` 3.5.0.
- **Invariant verified true:** `cumin` is the sole importer of `@fnndsc/chrisapi`
  (one file: `cumin/src/chrisapi/adapter.ts`; a dependency of cumin alone). The
  boundary check must grep imports (`from '@fnndsc/chrisapi'`), not string
  mentions — a comment once caused a false "leak."
- **calypso is single-tenant / personal:** one engine, one CUBE identity, many
  surfaces sharing one session; same-user discovery + one attach token. It is
  **not multi-user**. CUBE credentials live in the daemon, never on the wire.
- **CUBE is durable truth.** Daemon scrollback, progress, and conversational
  state are presentation or ephemeral context, never workflow authority.

## Next action — envelope Phase 2 (typed models)

Phase 1 (envelope-of-text) is done: every command returns an envelope. Phase 2:
every command also carries a typed `model` (`{ kind, data }`), with `rendered`
demoted to one view derived from it. Today only ~6/43 builtins set `.model` (the
`fs` mutations + `cat`); the rest are text-only.

- Contract, kind namespace, and the "rendered = view(model)" rule:
  `docs/envelope-model.adoc`.
- Worked examples to copy: `ls → fs.listing`, `feed list → feed.listing`.
- Recipe: name the model type in chili (add its arm to the `kind → type` union);
  build the typed object first; render from it; return `envelope_ok(rendered,
  model)`; keep observable text byte-identical.

Why it matters: a typed `model` over the wire is what lets a web console or an
agent consume mise **without ever touching Collection+JSON** — the same unlock
serves the forward agentic (HARBOR) layer, where `model` + `status` + `trace`
are the "truth outside the model" receipt.

## Conventions and hard rules

- `main` is protected: PR + strict CI (`check (22)`/`check (24)`) + enforce_admins.
  Branch for every change.
- **No Co-Authored-By / AI attribution** on commits or PRs.
- **MANDATORY** before writing source: the per-package `TYPESCRIPT-STYLE-GUIDE.md`
  (RPN `<object>_<method>` naming, explicit types, pervasive JSDoc). No process
  jargon (Phase/Wave/REMEDIATION) in source or config comments.
- Coverage provider is istanbul; there are per-file floors — new modules need
  their own tests (a new seam that drops a file below 60% will fail CI).
- Release: changesets. A merged PR → bot "Version Packages" PR; that bot PR does
  **not** get the required CI checks until nudged with an empty commit on its
  branch, then merging it publishes to npm in dependency order. Merging the
  Version Packages PR is the irreversible publish.

## Follow-ups and risks

- [#107](https://github.com/FNNDSC/mise/issues/107): the CALYPSO real-browser
  smoke skips in CI (env-flaky headless Chrome). Harden it so it can gate CI
  again; runs locally / nightly, or with `CALYPSO_BROWSER_REQUIRED=1`.
- [#94](https://github.com/FNNDSC/mise/issues/94): materialize live proof for
  structured `pull` progress and LONK/CUBE truth in E2E; needs a disposable,
  test-owned PACS fixture.
- [#104](https://github.com/FNNDSC/mise/issues/104) (console monkeypatch) and
  [#105](https://github.com/FNNDSC/mise/issues/105) (brasa extraction epic) are
  **complete and shipped but still open** — candidates to close.
- The live E2E job skips when `CUBE_*` secrets are absent; a green *skipped* job
  is not evidence exemplars ran — inspect step outcomes.
- Forward, not started: the language-assist layer in calypso (NL → validated
  intent; determinism boundary at the surface/engine seam) and multi-user
  calypso (needs per-user auth, N sessions/engines, removal of cumin process
  globals, wiring the dormant ALS `sinkScope` per `line_execute`, and credential
  brokering). Theory backbone: `~/Projects/intent-server` (the IAS and
  "agents will always lie" papers).

## Freshness contract

Every architectural, release, or project-state PR must update this file: the
verified `main` commit, date, current milestone, release state, and next action.
Routine dependency and typo-only PRs need not touch it. When an epic closes,
archive its detailed campaign record under `docs/history/` and reset this file
to the new current state. The PR author is responsible for semantic freshness;
CI cannot determine whether a handoff is truthful.
