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

`menu` · `cumin` · `salsa` · `chili` · `brasa` · `chell` · `calypso` · `argus` · `porter`

<br>

### CUBE says what is true.<br>`mise` says where things are.<br>Calypso is who is there.<br>`chell` and `argus` are how you look.

</div>

---

## What `mise` is

`mise` presents ChRIS — a platform of users, data, analysis programs and compute,
reached through a low-level web API — as a **POSIX-like computer**, and gives
that computer more than one surface.

The shell surface, `chell`, casts the world as files, directories and
executables. The web surface, `argus`, shows the same world as components you
drive in a browser. Neither is a client of the other, and neither is the
framework: they are two ways into one machine.

Underneath, `mise` is a stack of layers, each abstracting exactly one thing, all
standing on a single truth.

**CUBE is the truth** — the objects and the laws between them. It has no opinion
about where you are standing and no memory that you were just somewhere.

**`mise` is the world built on it**, and deliberately a familiar one: your data
is a filesystem, every plugin a command, every running job a file you can read.
A map, not a motor.

**`brasa` is how anything acts there** — the verbs, and the senses that go with
them. Nothing moves of its own accord.

**`calypso` is the one living thing in that world.** One login, one individual.
It holds the *now* and the *here*, and it persists and goes on after you leave.

**`chell` and `argus` are two views of it.** Never two copies: type `cd` in the
terminal and the browser has already moved.

There is a longer telling of that — the physics, the world, the bird and the
flight, the nymph of one island — at the head of
**[docs/mise.adoc](docs/mise.adoc)**.

### Why it exists

ChRIS stores research data — it grew up processing hospital brain-imaging
studies — and runs containerized analysis programs ("plugins") on that data
wherever the compute lives, keeping a precise record of what ran to produce
every result. You reach it through a web API where one useful task — *find this
scan, run this pipeline, fetch the result* — unfolds into a long chain of
dependent calls. Every tool built on ChRIS used to re-implement that plumbing,
and most stalled under it.

`mise` builds the plumbing once. At its centre is an **intent kernel**: a
deterministic engine that turns *what you want* into validated ChRIS actions and
hands back structured results. Nothing above it ever touches the raw API.

What that buys you is a machine instead of an endpoint. If you have used a
terminal, you already know most of it:

```bash
cd /home/chris/uploads/SAG-anon              # your data is a filesystem
ls /bin                                      # plugins and pipelines are executables
pl-fshack-v1.2.0 --inputFile brain.mgz       # run an analysis by name
cat /proc/jobs/feed_123/pl-fshack_789/status # watch it run
```

**`mise` is the framework; the kernel is the product.** The argument for why it is
built this way, and how the layers fit, is a paper of its own:
**[docs/mise.adoc](docs/mise.adoc)**. The shorter tour is
**[docs/gettingStarted.adoc](docs/gettingStarted.adoc)**.

---

## What you run

Four things, all driving the same engine.

| | what it is |
|---|---|
| **`chell`** | The shell. A terminal that holds the engine in-process. This is the deliverable most people want. |
| **`calypso`** | The daemon. Holds one engine as a long-lived **session** that surfaces attach to over a WebSocket. `chell --daemon` and the `calypso` binary run the same host code. |
| **`argus`** | The web surface: an LCARS console over a `calypso` session, with panes for files, feeds, the job graph, PACS, and a DICOM viewer. Ships with the stack — see [below](#argus-and-its-two-faces). |
| **`porter`** | The display manager: a login page for one CUBE that starts (or rejoins) your session on its host and shows your browser to `argus` — no tokens, no URLs to copy. What gdm is to a desktop. See [below](#log-in-through-the-door-porter). |

`chell` is a *surface*; `calypso` is a *host*; `porter` is the *door* to a host.
That is the whole distinction. Detail — running modes, attaching, host control,
scripting — is in **[docs/chell.adoc](docs/chell.adoc)**; the door is in
**[apps/porter/docs/porter.adoc](apps/porter/docs/porter.adoc)**.

---

## Install

### From npm

```bash
npm install -g @fnndsc/chell
chell
```

Requires Node.js ≥ 20.12 (22.x recommended). This brings the whole stack —
`calypso` the session daemon, and **`argus`** the web surface — so `chell --daemon`
serves a browser console as well as the wire.

### From a release binary — no Node.js

```bash
curl -L https://github.com/FNNDSC/mise/releases/latest/download/chell-linux-x64 -o chell
chmod +x chell
./chell
```

Published for `linux-x64`, `linux-arm64`, `macos-x64` and `macos-arm64`, with a
`SHA256SUMS` file, on every release.

### From the repository

The way to develop, and to run an unreleased `argus`:

```bash
git clone https://github.com/FNNDSC/mise && cd mise
make prep     # install dependencies (npm workspaces)
make cook     # build every package in dependency order (argus and porter included)
make serve    # link `chell` globally, so it runs from anywhere
```

`make taco` does the full course: scrub, prep, cook, taste, serve. From here
`make run` is the shell, `make daemon` a session, and `make porter` the door —
a browser login for a CUBE, [below](#log-in-through-the-door-porter).

**On versions:** the packages do not release in step, and they do not need to.
`chell` depends on version *ranges*, so installing the latest `chell` pulls the
latest compatible engine beneath it. A `chell` release numbered below a `salsa`
release does not mean you are behind.

---

## `argus`, and the faces it wears

**`argus`** is the web surface: an LCARS console with the terminal indwelling, and
panes for files, feeds, the job graph, PACS query and retrieve, and a DICOM
viewer. It ships with the stack — nothing to download, nothing to configure.

The look is switched in the page and remembered per browser. There are two kinds
of choice on that control.

**LCARS**, in four colour schemes on one frame: curved elbows, a coloured gutter,
Antonio set hard right.

| scheme | |
|---|---|
| **MEDICAL** *(default)* | Clinical blues. What a PACS pane sits in all day. |
| **LOWER DECKS** | The original, warm and loud. |
| **CERRITOS GOLD** | Gold and orange. |
| **NEMESIS** | Cool and dark. |

**PHAROS** is not a scheme but a theme of its own on the same tokens: `argus`'s own
visual language, the lighthouse, flat. Square corners, one curve in one seat, set
in Chakra Petch. Owing nothing to anyone.

Both looks are held to a **canon** — the computed style of every element of the
frame, committed under `apps/argus/tests/smoke/canon/` — so neither drifts by
accident. A change to the frame either matches the canon exactly, or says out
loud that it meant to change it.

### On TheLCARS.com

`argus` grew inside that template and no longer uses any of it. The frame is
written from `argus`'s own canon. The typeface is **Antonio**, vendored here under
the SIL Open Font License — it is the Antonio Project's, and the template only
carried a copy. The four sounds are synthesised by `scripts/sounds_make.mjs`.

The attribution stays, and should: the footer credits the template as the
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

**The web surface.** The same daemon prints one more line:

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

## Log in through the door (`porter`)

Everything above hands you a URL with a token in it. **`porter`** is the other
way in: a login page. It serves one CUBE. You give it your CUBE name and
password; it trades the password for a token at CUBE, starts your `calypso`
session on its host (or rejoins the one already running), and shows your
browser to `argus` at `/s/<key>/` — the porter holds the attach token, the
browser holds a cookie, and nothing sensitive is ever in the URL bar. It is what
gdm is to a desktop: the thing between "the machine is on" and "you are at your
session".

**From npm.** The porter brings the whole stack beneath it — `chell`, `calypso`, `argus` — so one install is the full login experience:

```bash
npm install -g @fnndsc/porter
PORTER_CUBE_URL=https://cube.example.org/api/v1/ porter
```

**From the checkout.** Point it at a CUBE and open the door:

```bash
make porter CUBE_URL=https://cube.example.org/api/v1/
```

That is `make cook` and then the binary with `PORTER_CUBE_URL`, `PORTER_PORT` and
`PORTER_STATE_DIR` set; every other setting below passes through from the
environment, so to reach it from another machine with a secret that survives a
restart:

```bash
PORTER_HOST=0.0.0.0 PORTER_SECRET=any-twenty-characters-or-more make porter CUBE_URL=https://cube.example.org/api/v1/
```

```text
[+] PORTER at http://127.0.0.1:4180/ for https://cube.example.org/api/v1/
    state:  /home/you/.local/state/porter
    chell:  /home/you/src/mise/packages/chell/dist/index.js
    idle:   sessions end after 24 h with nobody on them; their state directories stay
    secret: made up for this run — set PORTER_SECRET so a restart does not ask every browser again
```

Open that address, log in with your CUBE credentials, and watch the greeter: the
brain wakes while your session boots, the boot report scrolls beneath it, and
when the session answers you land in `argus`. **The first login of an identity on
a host is a cold boot** — the engine indexes your feeds and PACS from CUBE, which
takes a minute or more on a large CUBE. Every later login is warm: the porter
keeps each identity's state under `~/.local/state/porter/<key>/`, and a session
that is still running is simply rejoined. `LOG OUT` in `argus` clears the cookie
and leaves the session running; the porter ends a session on its own after a day
with no browser and no terminal on it.

Without `make`, the same thing is one environment variable and the binary:

```bash
PORTER_CUBE_URL=https://cube.example.org/api/v1/ node apps/porter/dist/porter.js
node apps/porter/dist/porter.js --status      # what sessions the state directory holds
```

**A terminal through the same door.** `chell` can log in the way the browser does,
so a TTY and a browser share one session without anyone copying a token:

```bash
chell --remote --door http://127.0.0.1:4180/        # asks for a name and a password
```

**Settings**, all environment, read once at start:

| variable | meaning |
|---|---|
| `PORTER_CUBE_URL` | Required. The one CUBE this door serves. `make porter` passes `CUBE_URL`. |
| `PORTER_STATE_DIR` | Where sessions keep their state. Default `~/.local/state/porter`. Precious: a fresh directory means every identity boots cold again. |
| `PORTER_HOST`, `PORTER_PORT` | Bind address, default `127.0.0.1:4180`. |
| `PORTER_SECRET` | Signs the cookie; at least twenty characters. Without it the porter makes one up per start, and every browser is asked to log in again after a restart. Only the porter needs it. |
| `PORTER_COOKIE_HOURS`, `PORTER_IDLE_HOURS` | How long a browser stays let in, and how long an unused session stands, each 24 by default. |
| `PORTER_CHELL` | The `chell` that starts sessions; default the one in this checkout. |

The porter listens on loopback. **To serve it to other machines, put TLS in
front** rather than binding wider: the cookie is the credential, and it must
travel over HTTPS. A systemd unit, an env file and a Caddyfile that do exactly
that are in [`apps/porter/deploy/`](apps/porter/deploy/), and the reasoning is in
[`apps/porter/docs/porter.adoc`](apps/porter/docs/porter.adoc).

---

## The packages

Seven, in a strict stack: each layer talks only to the one below it, so a script
or a surface bites in wherever it needs and ignores the rest.

| package | in one line |
|---|---|
| `@fnndsc/menu` | the words every layer agrees on |
| `@fnndsc/cumin` | the only layer that speaks CUBE's REST, so nothing above it has to |
| `@fnndsc/salsa` | the logic, and the filesystem CUBE never had |
| `@fnndsc/chili` | typed commands and the views that render them |
| `@fnndsc/brasa` | the engine that turns a typed line into a validated action |
| `@fnndsc/calypso` | where a session lives, under one login, when nobody is looking at it |
| `@fnndsc/chell` | the terminal you drive it from, here or over the wire |

The filesystem those layers project — `/home`, `/bin`, `/proc`, `/SERVICES/PACS`
— is described in **[docs/workspace-model.adoc](docs/workspace-model.adoc)**. Why
the stack is shaped this way: **[docs/mise.adoc](docs/mise.adoc)**. The engine's
contract with its surfaces: **[docs/intent-kernel.adoc](docs/intent-kernel.adoc)**
and **[docs/envelope-model.adoc](docs/envelope-model.adoc)**. Whether a surface
needs a view framework at all, and what `mise` does and does not remove:
**[docs/framework.adoc](docs/framework.adoc)**.

---

## Develop

One kitchen for the whole monorepo. `make` with no target lists everything.

| `make` | does | under the hood |
|--------|------|----------------|
| `shop` | freshen the pantry | `git pull` |
| `prep` | install deps (links all workspaces) | `npm install` |
| `cook` | build all, in dependency order | `npm run build` (`cumin`→`salsa`→`chili`→`brasa`→`calypso`→`chell`) |
| `taste` | run the full test suite | `npm test` |
| `taste-flight` | tests with coverage | workspace Jest configs (Istanbul/Babel provider) |
| `serve` | link `chell` globally | `npm link` |
| `scrub` | clean the kitchen | remove `dist/` + `node_modules` |
| `run` | build + launch the shell | `node packages/chell/dist/index.js` |
| `daemon` | build + run `calypso` daemon | `node packages/calypso/dist/calypso.js` |
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
    ├── argus/   @fnndsc/argus    the LCARS web surface (served by calypso)
    └── porter/  @fnndsc/porter   the display manager: login page + session host
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
