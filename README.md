<div align="center">

```
 ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
   T  U  I  —  the ChELL stack
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
```

**A ChRIS distributed-computing platform, presented as a Unix shell.**

`cumin` · `salsa` · `chili` · `chell` — four layers, one sandwich, cooked in one kitchen.

</div>

---

## What is this?

ChRIS stores data, analysis tools, and results behind a REST API. **ChELL** maps
all of it onto paths you already know:

```bash
cd /home/chris/uploads/SAG-anon       # your data is a filesystem
ls /bin                               # every plugin is a virtual executable
pl-fshack-v1.2.0 --inputFile brain.mgz   # run an analysis by name
cat /proc/feeds/feed_123/pl-fshack_789/status   # watch it run
```

If you know `bash` or `zsh`, you already know most of ChELL. Behind that shell
sits a clean, four-layer stack — the **Sandwich Model** — and each layer is its
own independently-published npm package, reusable on its own (a web client can
import the lower layers without ever touching the shell).

This repository is the **monorepo** that houses all four. They were once four
separate repos (`FNNDSC/{cumin,salsa,chili,chell}`); their full git history and
release tags live on here, under `packages/<name>/`.

---

## Install (end user)

### Standalone binary — no Node.js required

Download one file for your platform, make it executable, run it. Nothing else to
install:

```bash
curl -L https://github.com/FNNDSC/tui/releases/latest/download/chell-linux-x64 -o chell
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
   ┌────────────────────────────────────────────────────────────┐
   │  chell    @fnndsc/chell    REPL · builtins · completion    │  <- you type here
   ├────────────────────────────────────────────────────────────┤
   │  chili    @fnndsc/chili    typed commands · views · CLI    │  controller
   ├────────────────────────────────────────────────────────────┤
   │  salsa    @fnndsc/salsa    business logic · VFS · intents  │  logic
   ├────────────────────────────────────────────────────────────┤
   │  cumin    @fnndsc/cumin    connection · context · state    │  infrastructure
   ├────────────────────────────────────────────────────────────┤
   │  @fnndsc/chrisapi          raw ChRIS REST client           │  external (npm)
   └────────────────────────────────────────────────────────────┘
```

Each layer talks **only** to the one below it. Frontends other than the shell
(`chili` as a scriptable CLI, a future web app) tap in at the layer they need.

| Package | Backronym | Role | README |
|---------|-----------|------|--------|
| **chell** | **C**hELL **E**xecutes **L**ayered **L**ogic | The interactive shell — REPL, builtins, tab-completion, scripting | [packages/chell](packages/chell/README.md) |
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

## Develop

Everything runs from one kitchen. Clone, then `make taco`:

```bash
git clone https://github.com/FNNDSC/tui
cd tui
make taco            # scrub → prep → cook → taste → serve (the full course)
```

The metaphor is preserved from the original repos, re-wired for the monorepo —
no more cloning siblings or hand-linking, npm workspaces does it:

| `make` | does | under the hood |
|--------|------|----------------|
| `shop` | freshen the pantry | `git pull` |
| `prep` | install deps (links all four workspaces) | `npm install` |
| `cook` | build all, in dependency order | `npm run build` (cumin→salsa→chili→chell) |
| `taste` | run the full test suite | `npm test` |
| `taste-flight` | tests with coverage | `--coverage --coverageProvider=v8` |
| `serve` | link `chell` globally | `npm link` |
| `scrub` | clean the kitchen | remove `dist/` + `node_modules` |
| `run` | build + launch the shell | `node packages/chell/dist/index.js` |
| `taco` / `meal` | the full course | scrub → prep → cook → taste → serve |

Standard aliases also work: `make install` `build` `test` `clean` `link`.

### The dev loop

One `make prep` (or `npm install`) links all four workspaces to each other. Edit
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
tui/
├── Makefile                 # the kitchen (cooking-metaphor dev commands)
├── package.json             # npm workspaces + topological build/release scripts
├── .changeset/              # changesets config + pending changes
├── .github/workflows/       # ci.yml (build+test) · release.yml (changesets publish)
├── eslint.config.base.mjs   # shared flat config enforcing the style guide
└── packages/
    ├── cumin/   @fnndsc/cumin    infrastructure
    ├── salsa/   @fnndsc/salsa    logic + VFS
    ├── chili/   @fnndsc/chili    controller + CLI
    └── chell/   @fnndsc/chell    the shell
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
