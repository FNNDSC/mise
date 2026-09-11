<div align="center">

```
███╗   ███╗██╗███████╗███████╗
████╗ ████║██║██╔════╝██╔════╝
██╔████╔██║██║███████╗█████╗
██║╚██╔╝██║██║╚════██║██╔══╝
██║ ╚═╝ ██║██║███████║███████╗
╚═╝     ╚═╝╚═╝╚══════╝╚══════╝
```

**MISE** — *MISE Integrates the Sandwich Ecosystem*

**Drive ChRIS — a cloud platform for scientific analysis — like a computer, not a web API.**

![packages](https://img.shields.io/badge/packages-7-blue)
![source](https://img.shields.io/badge/source-42k_LOC-blue)
![tests](https://img.shields.io/badge/tests-~2k-brightgreen)
[![codecov](https://codecov.io/gh/FNNDSC/mise/branch/main/graph/badge.svg)](https://codecov.io/gh/FNNDSC/mise)
![license](https://img.shields.io/badge/license-MIT-green)

`menu` · `cumin` · `salsa` · `chili` · `brasa` · `chell` · `calypso`

</div>

---

## What mise is

ChRIS is a cloud platform for scientific analysis. It stores research data — it
grew up processing hospital brain-imaging studies — and runs containerized
analysis programs ("plugins") on that data wherever the compute lives, keeping a
precise record of what ran to produce every result. You reach it through a
low-level web API, where one useful task — *find this scan, run this pipeline,
fetch the result* — unfolds into a long chain of dependent calls. Every tool
built on ChRIS used to re-implement that plumbing, and most stalled under it.

mise builds the plumbing once. At its centre is an **intent kernel**: a
deterministic engine that turns *what you want* into validated ChRIS actions and
hands back structured results. Nothing above it ever touches the raw API.

What that buys you is a machine instead of an endpoint. Your data is a
filesystem. Every plugin and registered pipeline is an executable in `/bin`. A
running job is a live entry under `/proc`. If you have used a terminal, you
already know most of it:

```bash
cd /home/chris/uploads/SAG-anon              # your data is a filesystem
ls /bin                                      # plugins and pipelines are executables
pl-fshack-v1.2.0 --inputFile brain.mgz       # run an analysis by name
cat /proc/jobs/feed_123/pl-fshack_789/status # watch it run
```

**mise is the framework; the kernel is the product.** The argument for why it is
built this way, and how the layers fit, is a paper of its own:
**[docs/mise.adoc](docs/mise.adoc)**. The shorter tour is
**[docs/gettingStarted.adoc](docs/gettingStarted.adoc)**.

---

## What you run

Three things, all driving the same engine.

| | what it is |
|---|---|
| **chell** | The shell. A terminal that holds the engine in-process. This is the deliverable most people want. |
| **calypso** | The daemon. Holds one engine as a long-lived **session** that surfaces attach to over a WebSocket. `chell --daemon` and the `calypso` binary run the same host code. |
| **ARGUS** | The web surface: an LCARS console over a calypso session, with panes for files, feeds, the job graph, PACS, and a DICOM viewer. Runs from a checkout only — see [below](#argus-and-the-lcars-theme). |

chell is a *surface*; calypso is a *host*. That is the whole distinction. Detail —
running modes, attaching, host control, scripting — is in
**[docs/chell.adoc](docs/chell.adoc)**.

---

## Install

### From npm

```bash
npm install -g @fnndsc/chell
chell
```

Requires Node.js ≥ 20.12 (22.x recommended). This brings the whole stack,
calypso included, so `chell --daemon` works and other terminals can attach to it.
It does **not** bring ARGUS.

### From a release binary — no Node.js

```bash
curl -L https://github.com/FNNDSC/mise/releases/latest/download/chell-linux-x64 -o chell
chmod +x chell
./chell
```

Published for `linux-x64`, `linux-arm64`, `macos-x64` and `macos-arm64`, with a
`SHA256SUMS` file, on every release.

### From the repository

The only way to get ARGUS, and the way to develop:

```bash
git clone https://github.com/FNNDSC/mise && cd mise
make prep     # install dependencies (npm workspaces)
make cook     # build every package in dependency order
make serve    # link `chell` globally, so it runs from anywhere
```

`make taco` does the full course: scrub, prep, cook, taste, serve.

**On versions:** the packages do not release in step, and they do not need to.
chell depends on version *ranges*, so installing the latest chell pulls the
latest compatible engine beneath it. A chell release numbered below a salsa
release does not mean you are behind.

---

## ARGUS and TheLCARS.com

ARGUS wears an LCARS interface, and it grew inside the **Lower Decks** template
from [TheLCARS.com](https://www.thelcars.com/). It no longer uses any of it.

The frame is ARGUS's own, written from a measurement of ARGUS's own rendered
page and held to it at zero differences. The typeface is **Antonio**, vendored
here under the SIL Open Font License — it is the Antonio Project's, and the
template only ever carried a copy. The four sounds are synthesised by
`scripts/sounds_make.mjs` rather than borrowed.

**So there is nothing to download.** No `LCARS-26.zip`, no theme step, no
degraded build: clone it, build it, and it looks the way it looks. That is also
why ARGUS can be published at all.

The attribution stays, and should — the page footer credits the template as the
inspiration it was. Full reasoning, including the trade-dress question:
**[docs/argus.adoc](docs/argus.adoc)**.

---

## Start a surface

**The shell, on its own.** The engine runs in-process and dies with the shell.

```bash
chell
> connect --user <you> --password <••••> https://cube.chrisproject.org/api/v1/
> ls ; feed list ; ls /bin
```

**A session others can attach to.** The daemon logs in from your saved session
and prints where to reach it.

```bash
chell --daemon --host-control        # or: calypso
```

```text
[+] CALYPSO listening on ws://127.0.0.1:35739
    attach a surface with:  chell --remote you@http://cube.example.org/api/v1/
```

```bash
chell --remote you@http://cube.example.org/api/v1/   # same machine, by identity
chell --attach 'ws://host:35739/?token=4c9d98c3…'    # elsewhere; URL carries the token
calypso --berths                                     # what is running here
```

`--host-control` lets the session act on the machine the daemon runs on — `!`
escapes, pipes, `upload`/`download` — and is off unless asked for. It takes
tiers: `--host-control=files`, `--host-control=shell,pipes`, or bare for all.

**The web surface.** From a checkout that has been built, the same daemon prints
one more line:

```text
[+] ARGUS web surface at http://127.0.0.1:35739/?token=4c9d98c3…
```

Open it. **The token is in that URL, so the link is the whole credential** —
treat it as you would a password. To show it on another machine:

```bash
CALYPSO_BIND=0.0.0.0 chell --daemon --host-control --expose-host-control
```

`--expose-host-control` is the deliberate second yes: a non-loopback bind plus
host control means handing a shell on this machine to anyone holding the URL.

---

## The packages

Seven, in a strict stack: each layer talks only to the one below it, so a script
or a surface bites in wherever it needs and ignores the rest.

| package | role |
|---|---|
| `@fnndsc/menu` | the wire contract — envelope, session protocol, result models |
| `@fnndsc/cumin` | infrastructure — connection, context, state. The **only** layer that touches the raw ChRIS REST client |
| `@fnndsc/salsa` | logic, the virtual filesystem, intents |
| `@fnndsc/chili` | typed commands, views, its own CLI |
| `@fnndsc/brasa` | the hostable engine — parser, dispatch, pipes, builtins, session |
| `@fnndsc/calypso` | the session daemon — bus, berths, routing, and the `calypso` binary |
| `@fnndsc/chell` | the CLI surface, and the `--remote` client |

The filesystem those layers project — `/home`, `/bin`, `/proc`, `/SERVICES/PACS`
— is described in **[docs/workspace-model.adoc](docs/workspace-model.adoc)**. Why
the stack is shaped this way: **[docs/mise.adoc](docs/mise.adoc)**. The engine's
contract with its surfaces: **[docs/intent-kernel.adoc](docs/intent-kernel.adoc)**
and **[docs/envelope-model.adoc](docs/envelope-model.adoc)**.

---

## Develop

One kitchen for the whole monorepo. `make` with no target lists everything.

| `make` | does | under the hood |
|--------|------|----------------|
| `shop` | freshen the pantry | `git pull` |
| `prep` | install deps (links all workspaces) | `npm install` |
| `cook` | build all, in dependency order | `npm run build` (cumin→salsa→chili→brasa→calypso→chell) |
| `taste` | run the full test suite | `npm test` |
| `taste-flight` | tests with coverage | workspace Jest configs (Istanbul/Babel provider) |
| `serve` | link `chell` globally | `npm link` |
| `scrub` | clean the kitchen | remove `dist/` + `node_modules` |
| `run` | build + launch the shell | `node packages/chell/dist/index.js` |
| `daemon` | build + run CALYPSO daemon | `node packages/calypso/dist/calypso.js` |
| `remote` | build + attach to daemon | `node packages/chell/dist/index.js --remote` |
| `taco` / `meal` | the full course | scrub → prep → cook → taste → serve |

Front of house — every git and GitHub operation goes through these, never raw
`git`/`gh`:

| `make` | does |
|--------|------|
| `branch BR=name` | start a new branch off the current HEAD |
| `save MSG=".."` | commit tracked changes (new files need `git add` first) |
| `push` | push the current branch to origin, setting upstream |
| `pr` | push, then open a PR against `main` (body drawn from commits) |
| `ci-watch` | wait for this branch's PR checks (audit, Node 22/24) |
| `merge` | `ci-watch`, then merge this branch's PR |
| `publish` | green-wait + merge the Version Packages PR (releases to npm) |
| `verify-npm` | local package versions vs what the registry serves |
| `lockfile` | regenerate `package-lock.json` with CI's pinned npm |
| `ci-dispatch` / `release-dispatch` | fire a workflow when events lag |
| `sync` | back to `main`, fast-forwarded, stale remotes pruned |
| `tidy BR=name` | delete a merged branch, locally and on origin |

The dev loop, the branch-to-main flow, the style guides each package enforces,
and the test layers are in **[docs/gettingStarted.adoc](docs/gettingStarted.adoc)**
and each package's own README.

---

## Release

Independent versioning via [Changesets](https://github.com/changesets/changesets),
published to npm in topological order:

```bash
npx changeset        # record what changed, per PR
```

On merge to `main`, CI opens a **Version Packages** PR; merging it builds and
publishes the changed packages to npm. Each package keeps its own version and
its own `<name>-vX.Y.Z` tag. The chores around that PR are targets too:

```bash
make publish           # approve its bot CI runs, wait for green, merge it
make verify-npm        # confirm the registry now serves the new versions
make release-dispatch  # re-fire the publish workflow if no run appears (idempotent)
```

`make publish` is deliberately its own step, never chained onto `make merge`:
merging the Version Packages PR is the irreversible, outward-facing act that
puts new versions on npm.

---

## Repository layout

```
mise/
├── Makefile                 # the kitchen + front of house (dev, git, release)
├── package.json             # npm workspaces + topological build/release scripts
├── .changeset/              # changesets config + pending changes
├── .github/workflows/       # ci.yml (build+test) · release.yml (changesets publish)
├── eslint.config.base.mjs   # shared flat config enforcing the style guide
├── packages/
│   ├── menu/    @fnndsc/menu     the wire contract (zod schemas, models)
│   ├── cumin/   @fnndsc/cumin    infrastructure
│   ├── salsa/   @fnndsc/salsa    logic + VFS
│   ├── chili/   @fnndsc/chili    controller + CLI
│   ├── brasa/   @fnndsc/brasa    the hostable shell engine (kernel)
│   ├── calypso/ @fnndsc/calypso  session daemon + `calypso` bin
│   └── chell/   @fnndsc/chell    the CLI surface + `--remote` client
└── apps/
    └── argus/   @fnndsc/argus    the LCARS web surface (private: not published)
```

Each package directory carries its **own full git history** (preserved through
the monorepo migration) plus a rich README and deeper docs of its own —
`packages/chell/` in particular has `CONTEXT.md` (the ChRIS domain glossary) and
a `docs/` tree covering the VFS, plugin execution, the store, PACS, and more.

---

## License

MIT — part of the [ChRIS Project](https://chrisproject.org).

---
<div align="center"><sub>-30-</sub></div>
