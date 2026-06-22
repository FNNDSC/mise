# ChELL stack — remediation plan (converged)

Decisions locked via design review:

| # | decision | choice |
|---|---|---|
| 1 | repo topology | **Monorepo** (`FNNDSC/mise`), still publishes 4 standalone npm pkgs |
| 2 | scope | 4 stack packages only; `@fnndsc/chrisapi` stays external (consumed via npm) |
| 3 | versioning | **Independent** per package |
| 4 | release tooling | **Changesets** (+ npm workspaces for linking) |
| 5 | history | **Preserve** (git-filter-repo → `packages/<name>`, namespaced tags) |
| 6 | name / old repos | `FNNDSC/mise`; archive cumin/salsa/chili/chell **+ tui-dev** |
| 7 | shared-code home | data → **cumin**, presentation → **chili** (no new package) |
| 8 | chrisapi casts | **typed adapter in cumin** (anti-corruption layer); do NOT modify chrisapi |
| 9 | sequencing | **migrate first (big-bang)**, then smell fixes inside the monorepo |
| 10 | CI/release | **full automation** (GH Actions + Changesets release, `NPM_TOKEN` secret) |

Consumers are unaffected throughout: a web app still does `npm i @fnndsc/cumin`.
Already-published versions (cumin 3.2.4 … chell 4.2.8) stay valid; releases
continue forward from the monorepo.

---

## Phase 0 — Monorepo migration  (prerequisite, mechanical/atomic)
Create `FNNDSC/mise`:
1. `git filter-repo --to-subdirectory-filter packages/<name>` on each of the 4
   (tag-rename callback → `cumin-v3.2.4`, `chell-v4.2.8`, …).
2. Merge the four rewritten histories into a fresh monorepo; add root
   `package.json` (`workspaces: ["packages/*"]`), `.changeset/`, root tsconfig
   (project references), root ESLint config, GH Actions.
3. Keep each package's `^semver` inter-deps (Changesets bumps them; npm symlinks
   locally — no `workspace:` protocol since npm).
4. Smoke: install + build all + **692 tests** + `npm pack` bundle install test.
5. Archive `FNNDSC/{cumin,salsa,chili,chell,tui-dev}` with README → monorepo.
**Risk:** med (one-time history surgery). **No npm publish** (no code change yet).
**Exit:** monorepo green; dev = `git clone FNNDSC/mise && npm i`.

## Phase 1 — ESLint guardrail (root)
- Drop in the flat config (already drafted: `eslint.config.base.mjs`) at monorepo
  root with per-package overrides (libLayer: cumin/salsa; cliLayer: chili/chell).
- Baseline run → record warning counts (burn-down scoreboard). CI blocks on
  `error` rules only; aspirational rules stay `warn` for now.
**Risk:** none. **Exit:** `npm run lint` across workspaces; counts captured.

## Phase 2 — chrisapi adapter in cumin  (cast containment)
- `packages/cumin/src/chrisapi/adapter.ts`: the ONLY module that casts against
  the raw chrisapi client; exposes typed `get/list/PACS*` methods upward.
- Route cumin's internals through it; delete scattered `as unknown as` around the
  client. salsa/chili/chell consume cumin's clean types.
**Risk:** med. **Leverage:** high (kills the bulk of the 83 double-casts).
**Exit:** `no-unsafe-*`/`as unknown as` confined to the adapter; tests green.

## Phase 3 — Dedupe domain primitives
- **cumin** (data): `dicom/tag`, `pacs/model`+decode, `feeds/status`,
  `resources/sort`, `vfs/pacsPath` (normalize/queryId/cpSrc).
- **chili** (presentation): `statusColor`, chalk `*_renderLines`.
- Delete the ~5× tag / 3× status / 2× sort / 9-file PACS copies in
  salsa/chili/chell; import from cumin/chili instead.
**Risk:** med (characterization tests cover several). **Leverage:** high.
**Exit:** duplication grep → one home per primitive; tests green.

## Phase 4 — Real library boundaries (cumin/salsa)
- Remove `console.*` (cumin 58, salsa 37) + `process.exit` (cumin 2) from the
  library layers; return `Result`/errorStack, let chili/chell render+exit.
- Flip `libLayer` rules (`no-console`, `no-process-exit`) → error.
**Risk:** med. **Exit:** lib layers print-free.

## Phase 5 — Decompose god code (leaf, no ripple)
- Split `packages/chell/src/chell.ts` (1431) → `core/{dispatch,preprocess,boot,repl}`.
- Refactor remaining ≥80-line fns: `builtin_cubepath/query/store`,
  `handlers_initialize`, `resources_list`, `files_list`, `context_displaySingle`.
- Drive `max-lines-per-function`/`max-depth` warnings to 0.
**Risk:** low-med. **Exit:** 0 fns ≥80 lines; chell.ts < ~400.

## Phase 6 — Error model (optional, deepest)
- Eliminate the ~25 empty/ignored catches; evaluate replacing the global mutable
  `errorStack` singleton with explicit `Result` propagation.
**Risk:** high. Do last / only if wanted.

## Phase 7 — Lock it in
- Flip burned-down `warn` → `error`; CI enforces.
- Default branch `main` everywhere; Node engines `>=20.12`, CI matrix 20/22.
- (Optional) extract ESLint config to published `@fnndsc/eslint-config`.

---

## Open follow-ups (non-blocking, decide during execution)
- Test infra: chell uses ESM jest (`unstable_mockModule`); cumin/salsa/chili CJS.
  Leave split, or unify under one runner (e.g. vitest) — revisit, not load-bearing.
- Build orchestration: TS project references vs Turborepo for cached/ordered
  builds — start with project refs; add Turbo if build time hurts.

## Sequencing
```
0 migrate → FNNDSC/mise (no publish)
1 eslint guardrail
2 chrisapi adapter (cumin)      ┐ high-leverage core
3 dedupe (cumin/chili)         ┘
4 library boundaries (cumin/salsa)
5 decompose god code (chell/chili)
6 error model (optional)
7 enforce + housekeeping
```
Every phase ends green (build + 692 tests + install smoke); 2-7 release via
Changesets (independent bumps, automated topo publish).
