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

`menu` · `cumin` · `salsa` · `chili` · `brasa` · `chell` · `calypso` — one menu, one sandwich, one engine, one daemon, *mise en place* in one kitchen.

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
files, every analysis plugin and registered pipeline is a command in `/bin`, and
a running job is a live entry under `/proc`. Instead of writing API code, you
drive it:

```bash
cd /home/chris/uploads/SAG-anon       # your data is a filesystem
ls /bin                               # plugins and pipelines are virtual executables
pl-fshack-v1.2.0 --inputFile brain.mgz   # run an analysis by name
cat /proc/jobs/feed_123/pl-fshack_789/status   # watch it run
```

If you've used a terminal, you already know most of it.

Underneath, mise is more than the shell. It's a mature, layered stack of seven
focused packages whose core is a reusable engine — an *intent kernel* — that
turns *what you want* into validated ChRIS actions and hands back structured
results. chell is just its first surface; the same engine is built to be driven
by a web console or an AI agent, none of them ever touching the raw ChRIS API.
**mise is the framework; chell is the shell you run today.** See
**[docs/intent-kernel.adoc](docs/intent-kernel.adoc)** for the client's view and
**[docs/history.adoc](docs/history.adoc)** for how it got here.
**[docs/principles.adoc](docs/principles.adoc)** states the rules that bind the
design — including the ones this codebase currently breaks — and
**[docs/lineage.adoc](docs/lineage.adoc)** is the companion essay arguing where
they come from.

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
> ls /bin                  # every plugin and pipeline, as a virtual executable
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

### What an install gives you, and what it does not

Either install brings the whole stack: the shell, the engine, and **calypso**, the
session daemon, with its own `calypso` binary. `chell --daemon` works, and other
terminals can attach to it over the wire, on this machine or another.

It does **not** bring the ARGUS web surface. That is not published — see
**[Run the web surface](#run-the-web-surface-argus)** for why, and for how to run
it from a checkout.

Package versions do not move in step, and that is fine: chell depends on version
*ranges*, so installing the latest chell pulls the latest compatible engine
underneath it. A chell release older than a salsa release does not mean you are
behind.

---

## Run it as a session others can attach to

Everything above runs the engine **in-process**: chell starts it, uses it, and it
dies with the shell. The other way to run it is **hosted** — one long-lived
session that surfaces attach to over a WebSocket.

**chell** is a *surface*: a terminal that drives the engine. **calypso** is a
*host*: it holds one engine as a session and lets surfaces attach. They are the
same host code, so `chell --daemon` and the `calypso` binary do the same thing;
use whichever you have to hand.

```bash
chell --daemon                     # or: calypso
```

It logs into CUBE from your saved session, then prints where to reach it:

```text
[+] CALYPSO listening on ws://127.0.0.1:35739 (build bbff65)
    identity:  you@http://cube.example.org/api/v1/
    token:     4c9d98c3049ef1fe8fc86df3942fa552…
    attach a surface with:  chell --remote you@http://cube.example.org/api/v1/
```

Attach a terminal to it from another window, or from another machine:

```bash
chell --remote you@http://cube.example.org/api/v1/   # same machine, found by identity
chell --attach 'ws://host:35739/?token=4c9d98c3…'    # elsewhere; the URL carries the token
calypso --berths                                     # what is running here
```

### Host control — letting the daemon act on its own machine

A hosted session runs where the daemon runs, so by default it will not touch that
machine: `!` shell escapes, pipes and `upload`/`download` all stay off. Turn on
what you need, in tiers:

```bash
chell --daemon --host-control              # everything: shell, files, pipes
chell --daemon --host-control=files        # just upload/download against this disk
chell --daemon --host-control=shell,pipes  # a subset; or set CALYPSO_HOST_CONTROL
```

The daemon binds to loopback. `CALYPSO_BIND=0.0.0.0` opens it to the network for a
demo, and combining that with host control needs `--expose-host-control` as well —
an explicit "yes, hand a shell on this host to anyone holding the attach URL".
The attach token still gates every session.

---

## Run the web surface (ARGUS)

**ARGUS** is the browser surface over the same session: an LCARS console with the
terminal indwelling, plus panes for files, feeds, the job graph, PACS query and
retrieve, and a DICOM viewer.

**It runs from a checkout, not from an install.** A published `chell` gives you
the CLI, the session host and the wire — a remote chell can attach to it — but no
web surface, because ARGUS is not published to npm. The reason is its theme, and
it is worth reading the section below before you build.

```bash
git clone https://github.com/FNNDSC/mise && cd mise
make prep                       # install dependencies
make cook                       # build every package, ARGUS included
chell --daemon --host-control   # `make daemon` runs it without host control
```

The daemon now prints one extra line:

```text
[+] ARGUS web surface at http://127.0.0.1:35739/?token=4c9d98c3…
```

Open that URL. The token is in it, so the link is the whole credential — treat it
the way you would a password, and do not paste it into a chat you would not paste
a password into.

To show it on another machine, bind wider and open the printed address from there:

```bash
CALYPSO_BIND=0.0.0.0 chell --daemon --host-control --expose-host-control
```

### The LCARS theme, and why you have to fetch it yourself

ARGUS wears the **Lower Decks** template from
[TheLCARS.com](https://www.thelcars.com/), whose licence says *"You may not sell,
distribute, or retransmit the Template"* and *"You may not hotlink any of my
files … without permission."* So this repository neither ships the theme nor
downloads it for you, and `apps/argus/src/lcars/theme/` is gitignored. Every real
copy comes from the author's own distribution — yours.

**The build works without it.** `theme_ensure.mjs` writes a generated stub when it
finds no zip, so `make cook` succeeds and ARGUS runs with a plain, degraded look.

**For the real thing**, go to
[thelcars.com/download.php](https://www.thelcars.com/download.php) and press the
download button there — it hands off to the author's own Proton Drive, and the
file you want is `LCARS-26.zip`. The link is deliberately not reproduced here:
it is a share URL the author can rotate, and his page is where the licence and
the attribution terms are stated. Put the zip where the build looks. In order:

1. `LCARS_ZIP=/path/to/LCARS-26.zip`
2. `~/Downloads/LCARS-26.zip`
3. `LCARS-26.zip` beside `apps/argus/`

```bash
LCARS_ZIP=~/Downloads/LCARS-26.zip make cook
```

The script extracts only the members the page uses — the stylesheet, the Antonio
fonts, four beeps — into the gitignored theme directory. ARGUS credits the
template and notes that changes were made, as the licence requires.

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
   │ rendering, remote client │      │ berths, routing          │
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

   Spoken by every layer and every surface
   ═══════════════════════════════════════

   ┌────────────────────────────────────────────────────────────┐
   │  menu     @fnndsc/menu     the wire contract —             │  contract
   │           envelope · session protocol · result models      │
   └────────────────────────────────────────────────────────────┘
```

The lower packages are the strict Sandwich Model: each layer talks **only** to
the one below it. **brasa** is the shell engine lifted out of chell — parsing,
dispatch, builtins, session — hostable with no terminal of its own. **chell** is
one surface over that engine; a local shell drives brasa in-process, paying no
tax for a boundary it doesn't need. **CALYPSO** is not a layer stacked above the
engine but the session/daemon boundary: it hosts the same brasa engine and serves
it to remote and future web surfaces, so they drive it without ever learning
CUBE's Collection+JSON API. **menu** is the contract all of them speak: what a
command returns and what a session exchanges, in a package that depends on
nothing, so a surface author takes a dependency on the contract rather than on
the daemon that happens to serve it.

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
| `/bin` | Every plugin and Pipeline registered in this CUBE (virtual executables) |
| `/etc` | Config — compute environments, groups, users, CUBE info |
| `/net/pacs/queries/` | PACS query result sets |
| `/proc/jobs/` | Live job monitoring as a navigable DAG |

PACS selections can become analysis inputs in one operation: `pacs pull
<selection...> --new-feed "TITLE"` retrieves the complete set and creates one
named feed rooted in those resolved CUBE directories. `--plugin` and `--pipeline`
can attach one analysis to that explicit new root, forwarding its arguments after
`--`; the complete behavior is specified in
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

The kitchen also runs front of house. The operational chores around a change
(branching, committing, the PR, CI, merging, releasing) are targets too, so the
flow lives in the repo rather than in anyone's memory. These need an
authenticated [`gh`](https://cli.github.com/):

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

### From branch to main, all through make

A typical change travels like this. `main` is protected, so the PR is the only
road in; the required checks are the dependency audit and the build+test matrix
on Node 22 and 24.

```bash
make branch BR=my-change      # 1. start a branch; work never sits on main
# ... edit ...
make cook taste               # 2. build the stack, run the full suite
npx changeset                 # 3. if a published package changed: record the bump
git add path/to/new-file      # 4. stage any NEW files ('save' commits tracked only)
make save MSG="scope: what changed and why"
make pr                       # 5. push and open the PR against main
make merge                    # 6. wait out the required checks, then merge
make sync                     # 7. return to main, fast-forwarded
make tidy BR=my-change        # 8. delete the merged branch, local and origin
```

If the change bumped a published package, the merge causes CI to open a
**Version Packages** PR, and the release continues in the next section with
`make publish`. If not, step 8 is the end of the story.

Two escape hatches cover the operational failure modes that actually occur.
When GitHub's event delivery lags and no CI run appears on a fresh PR,
`make ci-dispatch` fires the workflow by hand (then `make ci-watch` as usual).
When CI fails `npm ci` with EUSAGE ("lock file out of sync"), the lockfile was
written by a different npm major than CI's pin: `make lockfile` regenerates it
with the pinned version and proves the result with the same dry-run `npm ci`
that CI runs first, after which `make save` and `make push` send the fix.

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
