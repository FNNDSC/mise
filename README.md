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

**A Unix-shell interface for ChRIS: a platform for storing data, running analysis
plugins, and tracking scientific workflows.**

`cumin` · `salsa` · `chili` · `brasa` · `chell` · `calypso` — one sandwich, one engine, one daemon, *mise en place* in one kitchen.

</div>

---

## What is this?

ChRIS is a distributed scientific-computing platform: it keeps data, analysis
plugins, workflow state, and results behind a REST API so computation can run
where the data lives. **MISE** turns that platform into a Unix-shaped working
environment. **ChELL**, the shell in this repo, maps ChRIS onto paths and
commands you already know:

```bash
cd /home/chris/uploads/SAG-anon       # your data is a filesystem
ls /bin                               # every plugin is a virtual executable
pl-fshack-v1.2.0 --inputFile brain.mgz   # run an analysis by name
cat /proc/feeds/feed_123/pl-fshack_789/status   # watch it run
```

If you know `bash` or `zsh`, you already know most of ChELL. But ChELL is now
only the *surface* — the readline loop and the terminal rendering. Behind it sits
**brasa**, the hostable shell *engine* (parsing, dispatch, builtins, session),
which in turn sits on a clean command substrate — the **Sandwich Model**. Each
layer is its own independently-published npm package, reusable on its own (a web
client can import the lower layers without ever touching the shell). And because
the engine is separable from any surface, **CALYPSO** — the session daemon and
wire contract — can host that same engine and serve it to remote and future web
surfaces.

This repository is the **monorepo** that houses all the packages. The original
four sandwich packages were once separate repos
(`FNNDSC/{cumin,salsa,chili,chell}`); their full git history and release tags
live on here, under `packages/<name>/`. CALYPSO was added here because its seams
are internal to the hosted chell engine and the daemon wire contract, and
**brasa** — the hostable engine lifted out of chell — followed for the same reason.

For the story of how the stack came to be — from the Collection+JSON burden that
every ChRIS client used to re-pay, to a single adapter that tamed it, to a shell,
to a hostable kernel a daemon can serve to many surfaces (and the language-assist
lever that makes possible) — see **[docs/history.adoc](docs/history.adoc)**.

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

Frontends other than the shell (`chili` as a scriptable CLI, a future web app, or
a remote CALYPSO surface) tap in at the layer they need.

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
| `/proc/feeds/` | Live job monitoring as a navigable DAG |

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
**S**hell **O**perations — is that intent layer. The name is a harbor reference.
In the *Odyssey*, Calypso keeps the island where the voyager finds haven; the name
is the Greek word for "to conceal," which the project keeps but turns around.
**HARBOR** is that haven for the ChRIS operator, and CALYPSO is the keeper at its
edge — the layer between you and the open water: the Collection+JSON sprawl, the
complexity of a federated backend. What CALYPSO conceals is the friction, never the
outcome. A harbor shelters without holding: the work is left as materialized,
verifiable state, yours to leave and return to — CALYPSO the harbor you pass
through, never the ground you stand on.

This is design-in-progress, not shipped. The full specification and reasoning:

- **[docs/calypso.adoc](docs/calypso.adoc)** — the intent layer and session daemon:
  doctrine, architecture, the wire contract, and the staged build plan.
- **[docs/surfaces.adoc](docs/surfaces.adoc)** — a companion essay on what the wire
  contract means for building user interfaces.

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
| `taste-flight` | tests with coverage | `--coverage --coverageProvider=v8` |
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
