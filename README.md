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

![packages](https://img.shields.io/badge/packages-6-blue)
![source](https://img.shields.io/badge/source-42k_LOC-blue)
![tests](https://img.shields.io/badge/tests-~2k-brightgreen)
[![codecov](https://codecov.io/gh/FNNDSC/mise/branch/main/graph/badge.svg)](https://codecov.io/gh/FNNDSC/mise)
![license](https://img.shields.io/badge/license-MIT-green)

`cumin` · `salsa` · `chili` · `brasa` · `chell` · `calypso` — one sandwich, one engine, one daemon, *mise en place* in one kitchen.

</div>

---

## What this is

ChRIS is a cloud platform for scientific analysis. It stores research data — it
grew up processing hospital brain-imaging studies — and runs containerized
analysis programs ("plugins") on that data wherever the compute lives, keeping a
precise record of what ran to produce every result. It's powerful, but you reach
it through a low-level web API, where one useful task — *find this scan, run this
pipeline, fetch the result* — unfolds into a long chain of dependent calls.
Historically, every tool built on ChRIS re-implemented that plumbing from
scratch, and most stalled under the weight of it.

mise builds that plumbing once and hands you ChRIS as something you *operate*
directly. What you run is **chell**, a shell: your data appears as folders and
files, every analysis plugin is a command in `/bin`, and a running job is a live
entry under `/proc`. Instead of writing API code, you drive it:

```bash
cd /home/chris/uploads/SAG-anon       # your data is a filesystem
ls /bin                               # every plugin is a virtual executable
pl-fshack-v1.2.0 --inputFile brain.mgz   # run an analysis by name
cat /proc/jobs/feed_123/pl-fshack_789/status   # watch it run
```

If you've used a terminal, you already know most of it.

Underneath, mise is more than the shell. It's a mature, layered stack of six
focused packages whose core is a reusable engine — an *intent kernel* — that
turns *what you want* into validated ChRIS actions and hands back structured
results. chell is just its first surface; the same engine is built to be driven
by a web console or an AI agent, none of them ever touching the raw ChRIS API.
**mise is the framework; chell is the shell you run today.** See
**[docs/intent-kernel.adoc](docs/intent-kernel.adoc)** for the client's view and
**[docs/history.adoc](docs/history.adoc)** for how it got here.

---

## Get started

The fastest way in — install the shell and point it at the public ChRIS instance:

```bash
npm install -g @fnndsc/chell        # or grab a standalone binary (see Install)
chell
> connect --user <you> --password <••••> https://cube.chrisproject.org/api/v1/
```

Then drive it:

```bash
> ls                       # your files and feeds, as a directory
> feed list                # every analysis you've run
> ls /bin                  # every plugin, as a virtual executable
> plugin search dircopy    # find an analysis
> pl-dircopy /home/<you>/uploads    # run one by name
> ls /proc/jobs           # watch running jobs, live
```

Prefer a single file with no Node.js? See **[Install](#install-end-user)** for
standalone binaries. Pointing at your own CUBE instead of the public cloud? Use
its `…/api/v1/` URL in `connect`.

**Full guide — [docs/gettingStarted.adoc](docs/gettingStarted.adoc):** building
from source (the `make` kitchen), every way to connect (`chell <user>@<url>` and
friends), and running the engine locally (in-process) or as a hosted **daemon**
(including how the daemon logs into CUBE).

---

## Why *mise*?

*Mise en place* — "everything in its place" — is the chef's discipline of prepping
and arranging every ingredient before the cooking starts, so service runs clean.
This project is built the same way: the messy work of talking to ChRIS is done
once, prepped, and set in its place at the bottom of the stack, so every layer
above cooks with clean, typed ingredients.

That messy work is real. ChRIS exposes everything through a REST API whose wire
format (Collection+JSON) is verbose to traverse, whose typings lag the live API,
and whose compound operations fan out into long chains of requests — every client
that speaks to it directly pays that cost again. **cumin** pays it once (it is the
only layer that ever touches `chrisapi`) and hands everything above it typed domain
objects. By the top of the stack, ChRIS is just a filesystem you already know how
to drive.

The kitchen runs through the naming: the deterministic layers season upward —
**cumin** → **salsa** → **chili** → **brasa**, the coals that cook the actions —
and **chell** is the shell you cook in (yes, a *Taco Chell*), one surface over
that engine. **CALYPSO** is the harbor/daemon that can host the same engine for
sibling surfaces. The dev workflow is still a recipe (`prep`, `cook`, `taste`,
`serve`, or `make taco` for the full course). It's a **sandwich** because the
command substrate is strict: each layer talks only to the one below it, so a web
app or a script bites in at whatever layer it needs and ignores the rest.

---

## Install (end user)

### Standalone binary — no Node.js required

Download one file for your platform, make it executable, run it. Nothing else to
install:

```bash
curl -L https://github.com/FNNDSC/mise/releases/latest/download/chell-linux-x64 -o chell
chmod +x chell
./chell
> connect --user chris --password chris1234 http://localhost:8000/api/v1/
```

Binaries are published for `linux-x64`, `linux-arm64`, `macos-x64` and
`macos-arm64` (with a `SHA256SUMS` file) on every release.

### From npm — if you already have Node.js

```bash
npm install -g @fnndsc/chell
chell
```

Requires Node.js ≥ 20.12 (22.x recommended).

---

## The Sandwich Model

```text
   Surfaces & hosts
   ════════════════

   local terminal                     remote terminal / web surface
          │                                       │
          ▼                                       ▼
   ┌──────────────────────────┐      ┌──────────────────────────┐
   │ chell    @fnndsc/chell   │      │ calypso  @fnndsc/calypso │
   │ CLI surface: REPL,       │      │ session daemon: bus,     │
   │ rendering, remote client │      │ wire contract, routing   │
   └────────────┬─────────────┘      └────────────┬─────────────┘
                │ hosts in-process                │ hosts for its surfaces
                └────────────────┬────────────────┘
                                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │  brasa    @fnndsc/brasa    hostable engine —               │
   │           parser · dispatch · pipes · builtins · session   │
   └────────────────────────────────────────────────────────────┘

   Shared command substrate
   ════════════════════════

   ┌────────────────────────────────────────────────────────────┐
   │  chili    @fnndsc/chili    typed commands · views · CLI    │  controller
   ├────────────────────────────────────────────────────────────┤
   │  salsa    @fnndsc/salsa    business logic · VFS · intents  │  logic
   ├────────────────────────────────────────────────────────────┤
   │  cumin    @fnndsc/cumin    connection · context · state    │  infrastructure
   ├────────────────────────────────────────────────────────────┤
   │  @fnndsc/chrisapi          raw ChRIS REST client           │  external (npm)
   └────────────────────────────────────────────────────────────┘
```

The lower packages are the strict Sandwich Model: each layer talks **only** to
the one below it. **brasa** is the shell engine lifted out of chell — parsing,
dispatch, builtins, session — hostable with no terminal of its own. **chell** is
one surface over that engine; a local shell drives brasa in-process, paying no
tax for a boundary it doesn't need. **CALYPSO** is not a layer stacked above the
engine but the session/daemon boundary: it hosts the same brasa engine and serves
it to remote and future web surfaces, so they drive it without ever learning
CUBE's Collection+JSON API.

Frontends other than the local shell (`chili` as a scriptable CLI, a future web
app, or a remote ChELL surface attached through CALYPSO) tap in at the layer they
need. CALYPSO is the assisted session host, not itself a user-facing surface.

| Package | Backronym | Role | README |
|---------|-----------|------|--------|
| **calypso** | **CALYPSO** **A**ccepts **L**anguage, **Y**ielding **P**ermitted **S**hell **O**perations | Session daemon and wire contract — hosts the brasa engine and serves it to remote/web surfaces; ships the `calypso` daemon binary | [packages/calypso](packages/calypso/README.md) |
| **chell** | **C**hELL **E**xecutes **L**ayered **L**ogic | The CLI surface — REPL, terminal rendering, prompt themes, tab-completion, the `--remote` client | [packages/chell](packages/chell/README.md) |
| **brasa** | **BRASA** **R**uns **A**bstracted **S**hell **A**ctions | The hostable engine (kernel) — parser, dispatch, pipes, builtins, session, output; no terminal of its own | [packages/brasa](packages/brasa/README.md) |
| **chili** | **ChILI** handles **I**ntelligent **L**ine **I**nteractions | Controller + standalone CLI — headless commands return typed models; views render them | [packages/chili](packages/chili/README.md) |
| **salsa** | **S**alsa **A**bstracts **L**ogic **S**ervice **A**ssets | Frontend-agnostic logic — high-level intents and the Virtual Filesystem dispatcher | [packages/salsa](packages/salsa/README.md) |
| **cumin** | **C**umin **U**nderpins **M**anagement **I**nfrastructure **N**eeds | The dirty work — connection, auth tokens, context persistence, IO, caches | [packages/cumin](packages/cumin/README.md) |

### The Virtual Filesystem

The magic that makes ChRIS feel like Unix lives in **salsa**'s VFS dispatcher,
which maps API resources onto paths:

| Path | What you see |
|------|--------------|
| `/home/<user>/` | Your uploaded files, directories, and feeds |
| `/bin` | Every plugin registered in this CUBE (virtual executables) |
| `/etc` | Config — compute environments, groups, users, CUBE info |
| `/net/pacs/queries/` | PACS query result sets |
| `/proc/jobs/` | Live job monitoring as a navigable DAG |

PACS selections can become analysis inputs in one operation: `pacs pull
<selection...> --new-feed "TITLE"` retrieves the complete set and creates one
named feed rooted in those resolved CUBE directories. Planned `--plugin` and
`--pipeline` additions will optionally attach an analysis to that new root while
keeping feed creation explicit; the current and planned behavior is specified in
[the PACS Q/R guide](packages/chell/docs/pacsqr.adoc#planned-analysis-attachment).

See [packages/chell/README.md](packages/chell/README.md) for the full tour
(running plugins, pipelines, the store, job monitoring) and
[packages/salsa/README.md](packages/salsa/README.md) for the VFS internals.

---

## Where this is going

chell began as a terminal program that was also its own engine. That engine —
dispatch, session, the filesystem projection — has now been lifted into
**brasa**, a package with no terminal of its own, so the *same* deterministic
command layer can back more than one surface.

The forward design, **CALYPSO**, makes the terminal the interface everywhere: a
session daemon hosts the brasa engine and serves it over a WebSocket to attached
surfaces — the CLI today, a web console next — each rendering the same session.
Because the engine can run apart from the surface, it can live where the data must
stay (inside a spoke's trust boundary) while an operator drives it over a thin
client. A later stage adds a natural-language layer that *proposes* commands,
always validated against the live platform before anything runs — the deterministic
shell is never outranked by a language model.

**CALYPSO** — **CALYPSO** **A**ccepts **L**anguage, **Y**ielding **P**ermitted
**S**hell **O**perations — is the session host and the home of that future
internal intent assist. The name is a harbor reference.
In the *Odyssey*, Calypso keeps the island where the voyager finds haven; the name
is the Greek word for "to conceal," which the project keeps but turns around.
**HARBOR** is that haven for the ChRIS operator, and CALYPSO is the keeper at its
edge — the layer between you and the open water: the Collection+JSON sprawl, the
complexity of a federated backend. What CALYPSO conceals is the friction, never the
outcome. A harbor shelters without holding: the work is left as materialized,
verifiable state, yours to leave and return to — CALYPSO the harbor you pass
through, never the ground you stand on.

The deterministic session host is shipped; natural-language assistance remains
forward work. The full specification and reasoning:

- **[docs/calypso.adoc](docs/calypso.adoc)** — the intent layer and session daemon:
  doctrine, architecture, the wire contract, and the staged build plan.
- **[docs/session-supervisor.adoc](docs/session-supervisor.adoc)** — shipped
  identity-keyed local daemons and the deferred network-facing server tier.
- **[docs/surfaces.adoc](docs/surfaces.adoc)** — a companion essay on what the wire
  contract means for building user interfaces.
- **[docs/feed-dag-viewer.adoc](docs/feed-dag-viewer.adoc)** — projecting feed and
  registered-pipeline DAGs into shared shallow trees and emitted SignalFlow YAML.

---

## Develop

Everything runs from one kitchen. Clone, then `make taco`:

```bash
git clone https://github.com/FNNDSC/mise
cd mise
make taco            # scrub → prep → cook → taste → serve (the full course)
```

The metaphor is preserved from the original repos, re-wired for the monorepo —
no more cloning siblings or hand-linking, npm workspaces does it:

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

Standard aliases also work: `make install` `build` `test` `clean` `link`.

### The dev loop

One `make prep` (or `npm install`) links all workspaces to each other. Edit
any layer, rebuild just that layer, and the layers above pick it up through the
workspace symlink — no republish, no relink:

```bash
npm run build -w @fnndsc/cumin   # rebuild just cumin
make run                         # chell sees the change immediately
```

> Use [nvm](https://github.com/nvm-sh/nvm) and Node 22.x to avoid needing `sudo`
> for the global link in `make serve`.

---

## Release

Independent versioning via [Changesets](https://github.com/changesets/changesets),
published to npm in topological order:

```bash
npx changeset        # record what changed, per PR
```

On merge to `main`, CI opens a **Version Packages** PR; merging it builds and
publishes the changed packages to npm. Each package keeps its own version and
its own `<name>-vX.Y.Z` tag.

---

## Repository layout

```
mise/
├── Makefile                 # the kitchen (cooking-metaphor dev commands)
├── package.json             # npm workspaces + topological build/release scripts
├── .changeset/              # changesets config + pending changes
├── .github/workflows/       # ci.yml (build+test) · release.yml (changesets publish)
├── eslint.config.base.mjs   # shared flat config enforcing the style guide
└── packages/
    ├── cumin/   @fnndsc/cumin    infrastructure
    ├── salsa/   @fnndsc/salsa    logic + VFS
    ├── chili/   @fnndsc/chili    controller + CLI
    ├── brasa/   @fnndsc/brasa    the hostable shell engine (kernel)
    ├── calypso/ @fnndsc/calypso  session daemon + wire contract + `calypso` bin
    └── chell/   @fnndsc/chell    the CLI surface + `--remote` client
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
