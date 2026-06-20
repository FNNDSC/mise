# ChELL: ChELL Executes Layered Logic

**The Interactive Shell for ChRIS**

ChELL is a command-line shell that presents a ChRIS distributed-computing platform as a familiar Unix filesystem. If you know `bash` or `zsh`, you already know most of ChELL.

## Installation

```bash
npm install -g @fnndsc/chell
```

Requires Node.js ≥ 20.12. This installs the `chell` command — see [Getting Started](#getting-started) to connect to a CUBE.

## The Concept

ChRIS stores data, analysis tools, and results behind a REST API. ChELL maps all of that onto paths:

- your data lives under `/home/<user>/`
- every registered plugin is a virtual executable in `/bin`
- system configuration is readable at `/etc`
- PACS query results surface under `/net/pacs/queries/`

You navigate with `cd`, inspect with `ls`, read files with `cat`, and run analyses by invoking plugin names — the same muscle memory you use on any Unix system.

---

## The Virtual Filesystem

The ChELL filesystem has two kinds of paths:

- **CFS (CubeFS)** — real ChRIS storage: files you upload, feed outputs, symlink files. Readable, writable, persistent.
- **VFS (Virtual)** — synthesised on the fly from API resources: plugins, config, PACS results. Read-only views, no stored bytes.

| Path | Type | What you see |
|------|:----:|-------------|
| `/home/<user>/` | CFS | Your uploaded files and directories |
| `/home/<user>/feeds/` | CFS | Your analysis feeds and their output trees |
| `/PIPELINES/` | CFS | Shared pipeline output data |
| `/PUBLIC/` | CFS | Publicly accessible files |
| `/SERVICES/` | CFS | Service-level data |
| `/SHARED/` | CFS | Cross-user shared data |
| `*.chrislink` | CFS | Symbolic links to other ChRIS paths |
| `/bin` | VFS | Every plugin registered in this CUBE |
| `/usr/bin` | VFS | Built-in shell commands (`whoami`, `whereami`, …) |
| `/etc/` | VFS | Config: compute environments, groups, users, CUBE info |
| `/net/pacs/queries/` | VFS | PACS query result sets |
| `/proc/feeds/` | VFS | Job monitoring — live status of all plugin instances |

```bash
cd /etc
cat compute.yaml          # inspect available compute environments
cat group                 # list groups

cd /bin
ls pl-mri*                # browse MRI-related plugins

cd /home/chris/feeds
ls -l                     # see your analysis feeds
```

### Symlinks (`.chrislink` files)

ChRIS uses `.chrislink` files as symbolic links. `ls -l` renders them as `l` entries; `cd` and `cat` follow them transparently. The link target is resolved through the VFS dispatcher — it can point anywhere in the virtual tree.

---

## Running Plugins

Because plugins live in `/bin` as virtual executables, you invoke them **directly by name** — exactly like running a local binary. ChELL uses your **current working directory** to determine context automatically, so you never need to supply a `--previous_id` by hand.

### Case 1 — Starting a new analysis from a data directory

```bash
cd /home/chris/uploads/SAG-anon
pl-fshack-v1.2.0 --inputFile brain.mgz --outputFile brain.nii
```

ChELL detects you are **outside a feed**. It:
1. Automatically runs `pl-dircopy` on the current directory to stage the data into a new feed
2. Attaches your plugin to that dircopy instance as the next step

A new feed is created for you — no boilerplate.

### Case 2 — Continuing an existing analysis

```bash
cd /home/chris/feeds/feed_123/pl-fshack_456/data
pl-segmentation-v1.0.0 --threshold 0.5
```

ChELL detects you are **inside a feed**. It extracts the plugin instance ID from the path (`456`) and uses it as `previous_id` automatically. The new plugin node is wired into the existing computation DAG.

### Naming feeds and instances

Use `--` to separate plugin parameters from feed-level context:

```bash
pl-fshack-v1.2.0 --inputFile brain.mgz -- feed_title="Brain MRI Study" instance_title="FreeSurfer recon"
```

Everything before `--` goes to the plugin; everything after sets ChRIS metadata.

### Monitoring

```bash
job inspect <instance_id>
jobs list --feed <feed_id>
```

### Installing new plugins

```bash
# Search the public peer store
store search simplefs

# Install (auto-discovers compute resources)
store install pl-simplefsapp

# Install pinned to specific compute
store install pl-simplefsapp --compute ares,argentum
```

`store install` runs a three-phase resolution:
1. Already in this CUBE → reports `[INFO] already registered`
2. Found in peer store (cube.chrisproject.org) → imports via admin API (prompts for admin credentials if needed)
3. Not found → Docker extraction and registration

---

## Running Pipelines

A **pipeline** is a registered template — a named, reusable graph of plugins with their parameter defaults wired together. Pipelines are static definitions; they do not run on their own.

A **workflow** is a live instantiation of a pipeline, attached to a specific feed node. Creating a workflow is the act of "running" a pipeline: ChRIS schedules each plugin step in order, feeding outputs of one into the inputs of the next.

```bash
# Browse registered pipeline templates
pipeline list
pipeline inspect <id>

# Instantiate a pipeline on an existing feed node → creates a workflow
workflow create <pipeline_id> --previous_id <instance_id>

# Monitor all the jobs it spawns
jobs list --feed <feed_id>
```

The `--previous_id` here is the feed node to attach the first pipeline step to — the same context that ChELL resolves automatically when you invoke a single plugin directly.

---

## Monitoring Jobs: `/proc/feeds/`

Because every plugin runs asynchronously in ChRIS, `/proc/feeds/` is where you come back to see what happened. It exposes all your visible feeds and their plugin instances as a navigable DAG — the same tree structure the computation actually ran in.

```
/proc/feeds/
└── feed_123/
    ├── status                        ← aggregate feed status
    ├── title                         ← feed name
    └── pl-dircopy_456/               ← root node (j = job type in ls -l)
        ├── status                    ← finishedSuccessfully
        ├── params
        ├── log
        └── pl-fshack_789/
            ├── status                ← started
            └── pl-segmentation_1011/
                └── status            ← scheduled
```

```bash
ls -l /proc/feeds/feed_123            # see all nodes with colour-coded status
cat /proc/feeds/feed_123/pl-fshack_789/status   # live status fetch
cat /proc/feeds/feed_123/pl-fshack_789/log      # stdout/stderr
cat /proc/feeds/feed_123/pl-fshack_789/params   # what it ran with

# Search across all jobs
tree /proc/feeds | grep 789           # find instance 789 and see its full lineage

# Cancel a running job
rm /proc/feeds/feed_123/pl-fshack_789

# Cancel all jobs in a feed (requires -r)
rm -r /proc/feeds/feed_123
```

Status colours in `ls -l`: green = `finishedSuccessfully`, yellow = `started`/`running`, gray = `scheduled`/`cancelled`, red = `finishedWithError`.

The cache is built lazily on first access to `/proc`. Rebuild explicitly after external activity (other users, web GUI):

```bash
proc refresh              # rebuild all
proc refresh feed_123     # scope to one feed
```

Since `/proc` paths encode the instance ID, you can also **continue an analysis from any node** just by `cd`-ing into it:

```bash
cd /proc/feeds/feed_123/pl-dircopy_456
pl-fshack-v1.2.0 --inputFile brain.mgz   # attaches here, no --previous_id needed
```

---

## Key Commands

### Filesystem
```bash
ls [-l] [-h] [-a]       # list directory
cd <path>               # change directory (follows .chrislinks)
cat <file>              # print file content
edit <file>             # open in $EDITOR, save back to ChRIS
cp / mv / rm            # copy, move, delete
mkdir / touch           # create directory or empty file
upload <local> <remote> # upload local file or directory tree
download <remote> <local>
tree                    # recursive listing
du                      # disk usage
```

### Resources
```bash
plugin list / search / inspect / run
plugins list [--search <term>] [--all]
feed list / inspect
feeds list [--user <name>] [--all]
feed note <id>          # read feed note
feed note edit <id>     # edit feed note in $EDITOR
feed comments <id>      # list comments
pipeline list / inspect
workflow list / create
job inspect <id>
compute list            # list compute environments
```

### Store
```bash
store list              # browse peer store
store search <query>
store install <plugin>  # install with admin escalation if needed
store inspect           # show current peer store URL
store set <url>         # override peer store
```

### System
```bash
whoami                  # current user and CUBE URL
whereami                # current working directory
connect --user <u> --password <p> <url>
logout
proc refresh            # rebuild /proc job cache
proc refresh feed_123   # scope rebuild to one feed
```

---

## Getting Started

```bash
# Start the shell, then connect interactively
chell
> connect --user chris --password chris1234 http://localhost:8000/api/v1/

# Connect via flags
chell -u chris -p chris1234 http://localhost:8000/api/v1/

# Compact user@host form (password prompted if omitted)
chell chris@localhost:8000/api/v1/
chell -p chris1234 chris@localhost:8000/api/v1/
```

### Scripting

```bash
# Non-interactive: single command via -c
chell -c "ls -l /home/user/study" > study_contents.txt
chell -c "store install pl-dircopy"

# Run a script file
chell -f my_workflow.chell
```

---

## Architecture

ChELL is the presentation layer of the "Sandwich Model":

1. **ChELL** — REPL, builtins, tab completion, prompt
2. **ChILI** — typed commands, views, CLI controllers
3. **Salsa** — business logic, VFS dispatcher, intent layer
4. **Cumin** — connection, context persistence, state
5. **`@fnndsc/chrisapi`** — raw ChRIS REST client

---

## Further Reading

| Document | Topic |
|----------|-------|
| [docs/vfs.adoc](docs/vfs.adoc) | VFS architecture — providers, dispatch, path resolution |
| [docs/pluginrun.adoc](docs/pluginrun.adoc) | Plugin execution in depth — new feed vs continue feed |
| [docs/plugin-run-summary.md](docs/plugin-run-summary.md) | Quick-reference summary of plugin run modes |
| [docs/store.adoc](docs/store.adoc) | Store install — three-phase resolution, admin escalation |
| [docs/login.adoc](docs/login.adoc) | Connection and authentication options |
| [docs/execution.adoc](docs/execution.adoc) | Command execution, scripting, and pipeline mode |
| [docs/commands.adoc](docs/commands.adoc) | Full command reference |
| [docs/pacsqr.adoc](docs/pacsqr.adoc) | PACS query and retrieve |
| [docs/physicalMode.adoc](docs/physicalMode.adoc) | Physical vs logical filesystem mode |
| [docs/gotchas.adoc](docs/gotchas.adoc) | Known edge cases and workarounds |
| [docs/architecture.adoc](docs/architecture.adoc) | Full architecture deep-dive |
| [CONTEXT.md](CONTEXT.md) | Domain glossary — ChRIS concepts, permission model, resource contract |

---

## License

Part of the [ChRIS Project](https://chrisproject.org).

---
*ChELL is part of the ChRIS Project.*

---
_-30-_
