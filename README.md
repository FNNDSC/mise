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

[![codecov](https://codecov.io/gh/HARBOR-Medical-AI/mise/branch/main/graph/badge.svg)](https://codecov.io/gh/HARBOR-Medical-AI/mise)
![license](https://img.shields.io/badge/license-MIT-green)

</div>

---

## What `mise` is

`mise` puts a shell between you and ChRIS. ChRIS is a platform for running analyses on medical data; its backend, CUBE, is a REST API. `mise` mounts that API as a filesystem (your data as directories, plugins as executables, running jobs as files you can read), runs a shell over it, and keeps the shell alive as a session on a server you log in to. You reach the session from a terminal or a browser, and both see the same state.

The figure is the whole of it: three machines, two networks. Your machine holds the surfaces. The bastion holds your session and the stack it stands on. CUBE is the only source of truth; everything above it is a view of it.

```text
┌─ your machine ───────────────────────────────────────────────────────────────────┐   a terminal, a browser,
│ ┌──────────┐                           you                                       │   and programs of your own
│ │ a program│                            │                                        │
│ └─┬────────┘                   ┌────────┴────────┐                               │
│   ┆ ┌──────────┐               │                 │                               │
│   ┆ │ a program│         ┌─────┴─────┐     ┌─────┴─────┐                         │
│   ┆ └─┬────────┘         │   chell   │     │   ARGUS   │                         │   surfaces: two views of one session
│   ┆   ┆ ┌──────────┐     │ terminal  │     │  browser  │                         │
│   ┆   ┆ │ a program│     └─────┬─────┘     └─────┬─────┘                         │
│   ┆   ┆ └─┬────────┘        ws │                 │ https, then ws                │
│   ┆   ┆   ┆                    └────────┬────────┘                               │
│   ┆   ┆   ┆                             └───┐                                    │
└───┼───┼───┼─────────────────────────────────┼────────────────────────────────────┘
    ┆   ┆   ┆                                 │  menu: the wire, across a network
╔═══╪═══╪═══╪═════════════════════════════════╪══ the bastion ═════════════════════╗   one Linux host: VM, container or metal
║   ┆   ┆   ┆                                 │                                    ║
║   ┆   ┆   ┆                     ┌───────────┴───────────┐                        ║
║   ┆   ┆   ┆                     │         porter        │                        ║   the login page (gdm)
║   ┆   ┆   ┆                     ├───────────────────────┤    ┌───────────────┐   ║   the console's own terminal, on a pty
║   ┆   ┆   ┆                     │        calypso        ├──┬─┤  chell (pty)  │   ║   your session, long-lived (tmux + sshd)
║   ┆   ┆   ┆               ┌─────┴───────────────────────┤  │ └───────────────┘   ║
║   ┆   ┆   ┆               │                             │  │                     ║
║   ┆   ┆   └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤            brasa            │  │ ┌───────────────┐   ║   the shell engine (bash + coreutils)
║   ┆   ┆                   │                             │  └─┤    the host   │   ║
║   ┆   ┆             ┌─────┴─────────────────────────────┤    │ a shell       │   ║   reached by `!`, under host control
║   ┆   ┆             │                                   │    │ ~/project     │   ║   the dev environment: edit, build, run
║   ┆   └┄┄┄┄┄┄┄┄┄┄┄┄┄┤                fond               │    └───────────────┘   ║   the filesystem interface (the VFS)
║   ┆                 │                                   │                        ║
║   ┆           ┌─────┴───────────────────────────────────┤                        ║
║   ┆           │                                         │                        ║
║   └┄┄┄┄┄┄┄┄┄┄┄┤               chris driver              │                        ║   a filesystem driver: CUBE as a tree
║               │   salsa   the tree, and its logic       │                        ║
║               │   cumin   CUBE's REST, via chrisapi     │                        ║
║               └─────────────────────────────┬───────────┘                        ║
║                                             │                                    ║
╚═════════════════════════════════════════════╪════════════════════════════════════╝
                                              │  HTTPS, Collection+JSON, across a network
                                   ┌─────────────────────┐
                                  ╱                     ╱│
                                 ╱         CUBE        ╱ │
                                ╱                     ╱  │
                               ┌─────────────────────┐   │
                               │                     │   │                            ChRIS: users, data, plugins, compute,
                               │                     │   ┘                            and the record of every run
                               │       what is       │  ╱
                               │         true        │ ╱
                               │                     │╱
                               └─────────────────────┘

────  a call, over a network
┄┄┄┄  the same package, linked into a program of your own: its own engine, its own process
```

Three facts the figure carries. A terminal and a browser are two views of one session: `cd` in one and the other has moved. A program of your own does not call the bastion; it links one layer into its own process and gets its own engine, and only a surface on the wire shares a session. The bastion is a real Linux host: `!` in the console runs on it, under the host-control tier the session was started with, which is what makes it a place to develop. In a Trusted Domain that host is a container on the cluster, one per cohort.

The names in parentheses (gdm, tmux, bash) are the comparison and nothing more; the full Linux reading is **[docs/linux-metaphor.adoc](docs/linux-metaphor.adoc)**, and the figures with the server opened (CUBE on OpenShift on a cloud substrate) are **[docs/architecture/overview.adoc](docs/architecture/overview.adoc)**.

### Why it exists

ChRIS stores research data (it grew up on hospital brain imaging) and runs containerised analysis programs, plugins, on that data wherever the compute lives, keeping a record of what ran to produce every result. Its backend, CUBE, speaks [Collection+JSON](http://amundsen.com/media-types/collection/): every object is an item whose fields are name/value pairs and whose relations are links to follow. One feed looks like this on the wire:

```json
{ "href": "https://cube/api/v1/3/",
  "data":  [ { "name": "id", "value": 3 }, { "name": "name", "value": "brain-study" } ],
  "links": [ { "rel": "plugin_instances", "href": "https://cube/api/v1/3/plugininstances/" } ] }
```

Nothing is addressed by name and nothing is typed. To run a plugin you fetch the plugin, follow its `parameters` link to learn what it takes, follow its `instances` link, post a template of name/value pairs, then poll the instance you got back. One useful task, *find this scan, run this pipeline, fetch the result*, is a long chain of such calls, and every tool built on ChRIS used to re-implement that chain.

`mise` builds it once. At its centre is an **intent kernel**, `brasa`: a deterministic engine that turns what you want into validated CUBE actions and hands back structured results. Nothing above it touches Collection+JSON. The same work in the shell:

```bash
cd /home/chris/uploads/SAG-anon              # your data is a filesystem
ls /bin                                      # plugins and pipelines are executables
pl-fshack-v1.2.0 --inputFile brain.mgz       # run an analysis by name
cat /proc/jobs/feed_123/pl-fshack_789/status # watch it run
```

The argument for the design is **[docs/mise.adoc](docs/mise.adoc)**; the tour is **[docs/gettingStarted.adoc](docs/gettingStarted.adoc)**.

---

## Install

**From npm.** Node.js 20.12 or later, 22.x recommended. One package brings the stack beneath it.

```bash
npm install -g @fnndsc/chell      # the terminal, with calypso and argus beneath it
npm install -g @fnndsc/porter     # the login page, with all of the above beneath it
```

**From a release binary**, no Node.js. Published for `linux-x64`, `linux-arm64`, `macos-x64` and `macos-arm64`, with a `SHA256SUMS` file, on every release.

```bash
curl -L https://github.com/HARBOR-Medical-AI/mise/releases/latest/download/chell-linux-x64 -o chell
chmod +x chell
```

**From the repository.** The way to develop, and the only way to run an unreleased `argus`.

```bash
git clone https://github.com/HARBOR-Medical-AI/mise && cd mise
make prep     # npm install, every workspace linked
make cook     # build every package in dependency order, argus and porter included
```

`make taco` is the full course (scrub, prep, cook, taste, serve); `make` alone lists every target.

---

## Run it

Three ways in, each a command. All three drive the same engine against one CUBE.

| you want | run | you get |
|---|---|---|
| a terminal, alone | `chell you@https://cube.example.org/api/v1/` | the shell, engine in-process; it dies with the shell |
| a session others attach to | `calypso`, then `chell --remote` or the printed URL | a daemon on loopback, a terminal and a browser on one session |
| a login page | `make porter CUBE_URL=https://cube.example.org/api/v1/` | a browser at `http://127.0.0.1:4180/`, log in, land in `argus` |

The first row collapses the figure: your machine is the bastion, and there is no wire. The other two are the figure as drawn.

**The terminal.** `chell` asks for the password, logs in, and remembers the session for next time (`chell` alone reconnects).

```bash
chell you@https://cube.example.org/api/v1/
> ls ; feed list ; ls /bin
```

**The daemon.** `calypso` (or `chell --daemon`) logs in from your saved session, holds the engine, and prints two lines: where a terminal attaches and where a browser opens.

```text
[+] CALYPSO listening on ws://127.0.0.1:35739
[+] ARGUS web surface at http://127.0.0.1:35739/?token=4c9d98c3…
```

The token is in that URL, so the link is the whole credential; treat it as a password. `--host-control` lets the session act on the bastion itself (`!` escapes, pipes, `upload`, `download`), the line into the host block of the figure, and is off unless asked for. Modes, attaching from elsewhere, host-control tiers and the exposure rules are in **[docs/chell.adoc](docs/chell.adoc)**.

**The login page.** `make porter` builds, then starts `porter` on `127.0.0.1:4180` for the one CUBE you name. Open it, give your CUBE name and password, and watch the greeter: the first login of an identity on a host is a cold boot (the engine indexes your feeds and PACS, a minute or more on a large CUBE); every later login is warm, and a session still running is rejoined. The porter holds the attach token, the browser holds a cookie, nothing sensitive is in the URL bar. From an install rather than the checkout:

```bash
PORTER_CUBE_URL=https://cube.example.org/api/v1/ porter
chell --remote --door http://127.0.0.1:4180/     # a terminal through the same door, same session
```

The porter listens on loopback. To serve other machines put TLS in front of it: the cookie is the credential. Settings, the systemd unit and the Caddyfile, and the reasoning are in **[apps/porter/docs/porter.adoc](apps/porter/docs/porter.adoc)**.

**The cloud.** The same login reaches the second backend: `:stratus oci` at the `argus` console switches to a `stratus` session over an Oracle Cloud tenancy, where a Trusted Domain is a folder under `/net/oci` and `domain` verbs build it. In the figure the driver block is then the cloud's and the cube is a tenancy; nothing else changes. **[docs/stratus.adoc](docs/stratus.adoc)**.

---

## `argus`

The web surface: a console with the terminal indwelling and panes for files, feeds, the job graph, PACS query and retrieve, and a DICOM viewer. The terminal in the page is a `chell` the session runs on the bastion under a pty; the browser shows it. It ships with the stack. The chrome is LCARS, borrowed fiction and credited as such; the design under it is not. **AEGIS** (**[apps/argus/docs/aegis.adoc](apps/argus/docs/aegis.adoc)**) is the interface standard every pane answers to, machine-checked, and a canon of the frame's computed style under `apps/argus/tests/smoke/canon/` holds the look to it. Themes, the canon and the attribution are in **[apps/argus/README.md](apps/argus/README.md)**.

---

## Develop against it

Three doors into the kernel, none of them Collection+JSON.

- **In-process.** The dashed lines of the figure: one layer as a library, with an engine of your own, in your own process; `!` in such a program runs on that program's host, not on a bastion. `@fnndsc/brasa`: hand it a line, get a `CommandEnvelope` back, a typed model with the rendered text as one view of it. `@fnndsc/fond` with the driver's mounts: the tree alone, list, read, copy, no verbs. `@fnndsc/salsa` or `@fnndsc/cumin`: CUBE's own objects, typed or raw. **[docs/intent-kernel.adoc](docs/intent-kernel.adoc)**, **[docs/envelope-model.adoc](docs/envelope-model.adoc)**.
- **Over the wire.** A `calypso` session speaks the contract in `@fnndsc/menu`: zod schemas for the envelope, the session protocol and every result model. A surface in any language attaches with a WebSocket and those schemas. **[docs/calypso.adoc](docs/calypso.adoc)**.
- **From the shell.** `chell -c` runs a line and exits; a script plays as a manifest. **[packages/chell/docs/script-reference.adoc](packages/chell/docs/script-reference.adoc)**.

The API reference is generated from the sources: **[harbor-medical-ai.github.io/mise/api](https://harbor-medical-ai.github.io/mise/api/)**, beside the guides at **[harbor-medical-ai.github.io/mise](https://harbor-medical-ai.github.io/mise/)**. The filesystem the backends project is **[docs/workspace-model.adoc](docs/workspace-model.adoc)**.

---

## Repository

npm workspaces, built in dependency order. Each package carries its own README and docs; `packages/chell/docs/` is the deepest.

```
mise/
├── packages/
│   ├── fond/     @fnndsc/fond     what every layer needs, whatever the backend; depends on nothing in @fnndsc
│   ├── menu/     @fnndsc/menu     the wire contract: envelope, session protocol, result models
│   ├── cumin/    @fnndsc/cumin    the only layer that speaks CUBE's REST
│   ├── salsa/    @fnndsc/salsa    the logic, and the filesystem CUBE never had
│   ├── chili/    @fnndsc/chili    typed commands and views from before the driver, being folded into it
│   ├── brasa/    @fnndsc/brasa    the engine: a typed line in, a validated action out
│   ├── stratus/  @fnndsc/stratus  the cloud backend: a tenancy under /net, clouds as drivers, OCI first
│   ├── calypso/  @fnndsc/calypso  the session daemon
│   ├── chell/    @fnndsc/chell    the terminal, here or over the wire
│   ├── orrery/   @fnndsc/orrery   layouts, drawers and controls a surface draws, knowing nothing of what they hold
│   └── trek/     bsd-trek         BSD trek(6), ported line for line; plays in chell and argus
├── apps/
│   ├── argus/    @fnndsc/argus    the web surface, served by calypso
│   └── porter/   @fnndsc/porter   the login page and session host
├── docs/                          architecture, design and the guides
├── .changeset/                    pending changes, one per PR
└── .github/workflows/             ci.yml · release.yml · docs.yml · binaries.yml · e2e.yml
```

**Develop.** `make prep`, edit, `npm run build -w @fnndsc/<package>`, `make run`; the layers above pick the change up through the workspace link. The dev loop, the branch-to-main flow through `make`, the style guide each package enforces and the test layers are in **[docs/gettingStarted.adoc](docs/gettingStarted.adoc)**.

**Release.** Every PR records what changed with `npx changeset`. On merge to `main` CI opens a Version Packages PR; `make publish` merges it, and the changed packages go to npm in topological order, each with its own version and `<name>-vX.Y.Z` tag.

---

## License

MIT — part of the [ChRIS Project](https://chrisproject.org).
