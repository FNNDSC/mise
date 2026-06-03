# ChELL: ChELL Executes Layered Logic

**The Interactive Shell for ChRIS**

ChELL is a command-line shell that presents a ChRIS distributed-computing platform as a familiar Unix filesystem. If you know `bash` or `zsh`, you already know most of ChELL.

## The Concept

ChRIS stores data, analysis tools, and results behind a REST API. ChELL maps all of that onto paths:

- your data lives under `/home/<user>/`
- every registered plugin is a virtual executable in `/bin`
- system configuration is readable at `/etc`
- PACS query results surface under `/net/pacs/queries/`

You navigate with `cd`, inspect with `ls`, read files with `cat`, and run analyses by invoking plugin names — the same muscle memory you use on any Unix system.

---

## The Virtual Filesystem

ChELL's filesystem is entirely virtual — there is no local disk. Every path maps to a ChRIS API resource via the `vfsDispatcher` in `salsa`. Different path prefixes are served by different providers:

| Path | What you see |
|------|-------------|
| `/home/<user>/` | Your uploaded files and directories |
| `/home/<user>/feeds/` | Your analysis feeds (each is a directory tree) |
| `/bin` | Every plugin registered in this CUBE, as a virtual executable |
| `/usr/bin` | Built-in introspection commands (`whoami`, `whereami`) |
| `/etc/compute.yaml` | All compute environments in YAML |
| `/etc/group` | LDAP-style group listing |
| `/etc/passwd` | User listing |
| `/etc/cube` | CUBE instance info |
| `/net/pacs/queries/` | PACS query result sets |
| `*.chrislink` | Symbolic links to other ChRIS paths |

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

Plugins live in `/bin` as virtual executables. To run one, use `plugin run`:

```bash
# Run by name (resolves latest registered version)
plugin run pl-dircopy --previous_id 14 --dir .

# Run by exact versioned name (from /bin listing)
plugin run pl-dircopy-v2.1.1 --previous_id 14 --dir .

# Check status of the resulting job
job inspect <instance_id>
```

`plugin run` creates a **plugin instance** — a ChRIS job. It needs a `previous_id` (the feed node to attach to). The result is a new node in the feed's computation DAG.

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

Pipelines are pre-wired sequences of plugins. List what's available, then instantiate one as a **workflow** on an existing feed node:

```bash
# Browse registered pipelines
pipeline list

# Inspect a specific pipeline
pipeline inspect <id>

# Create a workflow from a pipeline on a feed node
workflow create <pipeline_id> --previous_id <instance_id>
```

A workflow runs all pipeline steps in order, wiring outputs to inputs automatically. Monitor progress:

```bash
job inspect <instance_id>
jobs list --feed <feed_id>
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
```

---

## Getting Started

```bash
# Start the shell
chell

# Connect
> connect --user chris --password chris1234 http://localhost:8000/api/v1/

# Or connect directly from the command line
chell -u chris -p chris1234 http://localhost:8000/api/v1/
```

### Scripting

```bash
# Non-interactive: pipe commands via -c
chell -c "ls -l /home/user/study" > study_contents.txt
chell -c "store install pl-dircopy"
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
*ChELL is part of the ChRIS Project.*
