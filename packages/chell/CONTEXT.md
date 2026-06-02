# ChELL Domain Glossary

## Resource

A server-side ChRIS API entity — `Feed`, `Plugin`, `Group`, `Tag`, `Workflow`, etc. A Resource exists on the CUBE server regardless of whether chell knows about it. Resources are defined by the `@fnndsc/chrisapi` client.

## Resource Command

A chell builtin that surfaces a Resource interactively. Every Resource should have exactly one Resource Command. The sentence "every Resource must have a Resource Command" is the architectural goal of the 3.0/4.0 refactor.

A Resource Command must implement the **Resource Contract** (see below).

## Store

The peer ChRIS plugin registry — an external ChRIS instance (default: `https://cube.chrisproject.org/api/v1/`) used as an upstream source for discovering and installing Plugins. The Store is **not a backend Resource** — it is queried via raw HTTP with no authentication and no `ChRISResourceGroup` involvement. It is fundamentally different from the local CUBE registry.

- `store list` / `store search` — browse the external peer Store
- `plugins list` — list Plugins already installed in the local CUBE

The Store URL is configurable via `store set <url>` (persisted to session config) and `store reset` (restores default). The default is a known coupling point.

**Config persistence:** two distinct config locations exist:
- `~/.config/chell/settings.json` — chell UI and behaviour settings (prompt theme, store URL, display preferences)
- `~/.config/@fnndsc/cumin/` — session state (auth tokens, current user, CUBE URL, CWD)

`store set <url>` persists to `~/.config/chell/settings.json`.

## Plugin

A specific versioned executable registered in CUBE — corresponds to the API `Plugin` entity (e.g. `pl-dircopy v2.1.1`). Plugins appear as entries in the virtual `/bin` directory.

Not to be confused with **PluginMeta** — the abstract tool identity across all versions (e.g. `pl-dircopy`, any version). When a user searches for a plugin they are searching PluginMetas; when they run or install one they are targeting a specific Plugin version.

## PluginMeta

The abstract identity of a tool across all its registered versions. A PluginMeta has one or more Plugins (versions). Searching the Store returns PluginMetas; installing creates a new Plugin under an existing or new PluginMeta.

## Feed

A Feed is a first-class ChRIS object with a dual identity — intentional, not accidental:

1. **Feed as Computation** — a DAG of linked PluginInstances representing an analysis workflow. The canonical API entity with an ID, owner, title, and status.
2. **Feed as Folder** — a navigable directory in the VFS, located at `/home/<user>/feeds/<feed-name>/`, containing the output files of all PluginInstances in the DAG.

These are the same object seen from two angles. This duality is a deliberate architectural unification: ChRIS is simultaneously a compute platform and a filesystem. The filesystem naming convention for all objects was an explicit design decision made early, before a real VFS existed, to preserve navigability as a first-class property.

**Known divergence:** `feeds list` (Resource Command, uses `client.getFeeds()`) and `ls /home/<user>/feeds/` (VFS folder listing) are two views of the same data but can return different counts. The API applies ownership/sharing logic server-side (e.g. the `chris` superuser sees all non-public feeds via the API but only owned feeds via the VFS folder). This is a known and expected divergence — not a bug.

**Historical note:** the pervasive filesystem model was adopted gradually and with pushback. The Feed concept predates the VFS — feeds were originally linked lists of plugin instances with no folder metaphor. The folder metaphor was imposed on the naming convention first, then later backed by a real VFS implementation.

## Admin

A user with elevated privileges sufficient to execute a privileged operation. In chell help text, subcommands requiring elevation are marked `[admin]`.

**Current ChRIS implementation is brittle:** admin privilege is determined by `username == 'chris'` (hardcoded name check) or `is_staff == True` (Django flag), depending on the operation. This is tech debt — privilege should be role-based (e.g. `is_staff` throughout, analogous to Unix uid=0), not name-based. A legitimate user named "chris" would incorrectly receive superuser feed access. Tracked as known tech debt in the backend.

## Job

User-facing alias for a single `PluginInstance` — not a distinct concept. A Workflow spawns many Jobs. In chell, `job`/`jobs` and `instance`/`instances` are aliases for the `plugininstance` Resource Command.

## Command Grammar: `<object> <verb>`

All chell commands follow `<object> <verb>` order — the same RPN (Reverse Polish Notation) principle as the TypeScript function naming convention documented in `TYPESCRIPT-STYLE-GUIDE.md`, applied to the shell command surface.

```
plugins list        ✓
plugins inspect     ✓
plugin run          ✓
list plugins        ✗  (wrong order)
```

This is the single most important naming convention in chell. All new subcommands must follow it. Agents working on this codebase frequently drift toward `<verb> <object>` — check every new command name against this rule before committing.

See `TYPESCRIPT-STYLE-GUIDE.md` for the equivalent `<object>_<verb>` convention for TypeScript function names.

## Singular vs Plural Command Convention

Every Resource Command is registered under both its singular and plural forms. These are semantically distinct by convention:

- **Plural** (`plugins`, `feeds`, `groups`) — collection operations: `list`, `search`, `inspect`
- **Singular** (`plugin`, `feed`, `group`) — single-item operations: `run`, `add`, `delete <id>`, `cancel <id>`, etc.

Both forms are accepted for either operation (aliases), but the convention signals intent and should be followed in documentation and examples.

## Standard Subcommands

The subcommands every Resource Command must implement:

- `list` — list resource instances
- `search` — alias for `list --search` 
- `inspect` — resource-level: list available field names (for use with `--fields`, `--sort`, `--search`)

## Standard Options

The options every `list` / `search` invocation must honour:

- `--all` — fetch all pages
- `--limit <n>` — page size (default: 20)
- `--fields <f,f>` — columns to display
- `--sort <field>` — sort by field
- `--reverse` — reverse sort order
- `--table` — tabular output
- `--csv` — CSV output

## VFS (Virtual File System)

The unified filesystem abstraction chell uses to navigate both real and virtual paths. Implemented via `VFSDispatcher` (salsa) which routes paths to the appropriate `VFSProvider`.

Two classes of path:

**Native paths** — backed by real CUBE storage, managed by the backend:
- `/home/<user>/` — user storage (uploads, feeds, links)
- `PUBLIC/` — public files
- `SHARED/` — shared files
- `PIPELINES/` — pipeline source files
- `/SERVICES/PACS/` — DICOM files (via `PacsVfsProvider`)

**Virtual paths** — client-side only, synthesised by chell, no backend storage:
- `/bin` — registered plugins as executables (`StaticVfsProvider`)
- `/usr`, `/usr/bin` — static virtual content (`StaticVfsProvider`)
- `/etc` — ChRIS resource metadata as Unix config files (`EtcVfsProvider`)
- `/net`, `/net/pacs`, `/net/pacs/queries` — structural navigation stubs

The dispatcher matches the most-specific prefix first. Unmatched paths fall through to `NativeVfsProvider`.

**Provider split rule:** providers that are pure data routing live in salsa (`NativeVfsProvider`, `PacsVfsProvider`, `EtcVfsProvider`); providers that involve chell-specific rendering or plugin display logic live in chell (`StaticVfsProvider` for `/bin`, `/usr`).

## Permission Model

### ChRIS is not Linux

Linux and ChRIS both expose a filesystem metaphor, but their permission models differ at a fundamental level:

| | Linux | ChRIS |
|---|---|---|
| `ls /home/` | Lists **all** user directories | Lists only **visible** user namespaces |
| Access denied | Directory entry **exists**, read returns EPERM | Directory entry does **not appear** |
| Enforcement layer | Filesystem kernel (uid/gid/mode) | API server (Django ownership + group ACLs) |
| Client role | Trust kernel, show everything | Trust API response, show only what is returned |

In Linux, permissions gate access to things you can see exist. In ChRIS, the API filters before returning — you cannot observe resources you lack permission to see. The TUI is faithful to this: it renders what the API returns and nothing more. It does not synthesise paths it has no permission to back.

### Visibility Tiers

**Admin (is_staff / username `chris`):**
- `client.getFeeds()` returns all feeds from all users
- `ls /home/` returns all user namespaces
- `ls /home/radstar/feeds/` works — lists radstar's owned feeds
- Can register plugins, manage groups, create compute resources

**Regular authenticated user:**
- `client.getFeeds()` returns only owned + shared-with-me feeds
- `ls /home/` returns only `/home/<me>/` — other user namespaces are not surfaced
- Cannot reach `/home/radstar/` at all — the path simply does not exist in the API response
- This is stricter than Linux: the directory entry itself is hidden, not just the content

**Public:**
- Feeds and files marked public are accessible without authentication via `PUBLIC/`

### Two Views of the Same Data

The Web UI and TUI surface the same permission model but through different projections:

```
Web UI (admin):   client.getFeeds()         → all feeds, flat list, no path scoping
TUI (admin):      ls /home/chris/feeds/     → chris's owned feeds, path-scoped
                  ls /home/radstar/feeds/   → radstar's owned feeds, path-scoped
```

Both are correct. They answer different questions:

- **Web UI global view** — "what feeds exist that I can see?" (API global query)
- **TUI per-user path view** — "what feeds does this user own in their namespace?" (VFS path scope)

An admin using `feeds list` in chell gets the Web UI view (all feeds, flat). An admin using `ls /home/chris/feeds/` gets only chris's owned feeds. This divergence is documented under **Feed** above and is expected, not a bug.

### Feed Sharing and the SHARED/ namespace

Feeds can be shared with users or groups. Shared feeds do **not** appear in the recipient's `/home/<me>/feeds/` — they appear under `SHARED/`. This preserves the invariant that `/home/<user>/feeds/` contains exactly and only that user's owned feeds.

```
/home/radstar/feeds/FEAT_brain_seg/   ← radstar owns this
SHARED/FEAT_brain_seg/                ← appears here for users radstar shared with
```

A user who receives a shared feed navigates to it via `SHARED/`, not via the owner's home.

### Implication for `/home/` listing

When chell renders `ls /home/`, it asks the API for accessible user namespaces. The API enforces visibility:

- Admin gets all user directories → `ls /home/` shows everyone
- Non-admin gets only their own → `ls /home/` shows only `<me>/`

The TUI does not add or suppress entries. It renders exactly what the API returned. This means the TUI naturally models ChRIS's permission topology without any client-side ACL logic.

## Resource Contract

The full-stack requirement every Resource Command must satisfy:

```
chell builtin → chili command → salsa fn pair → cumin ChRISResourceGroup → chrisAPI client
```

Concretely: every Resource Command must support the **Standard Subcommands** and **Standard Options** defined below, routed through `ChRISResourceGroup` without hardcoded limits or bypasses.
