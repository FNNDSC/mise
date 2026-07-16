```
 ____        _
/ ___|  __ _| |___  __ _
\___ \ / _` | / __|/ _` |
 ___) | (_| | \__ \ (_| |
|____/ \__,_|_|___/\__,_|
```

**Salsa Abstracts Logic Service Assets**

`salsa` is the logic layer of the ChRIS interface ecosystem. It encapsulates high-level business intents and operational logic, serving as the bridge between user-facing interfaces (`chell`, `chili`) and the underlying infrastructure (`cumin` and `chrisapi`).

## Installation

```bash
npm install @fnndsc/salsa
```

Requires Node.js ≥ 20.12. Ships with TypeScript type definitions. Depends on [`@fnndsc/cumin`](https://github.com/FNNDSC/cumin).

## Usage

```typescript
import { files_listAll, fileContent_get, vfsDispatcher } from "@fnndsc/salsa";

// Salsa returns pure data / typed objects — no CLI dependencies
const listing = await files_listAll({ limit: 1000, offset: 0 }, "files", "/home/chris");
const content = await fileContent_get("/home/chris/uploads/notes.txt");
```

See [Key Modules](#key-modules) for the full intent catalogue.

## Purpose

- **Consolidate Business Logic**: Centralises intents such as "list directory", "upload file", "register plugin", "fetch feed note". All frontends share identical behaviour.
- **Frontend Agnostic**: No CLI-specific dependencies (`commander`, `process.stdout`). Returns pure data or typed objects.
- **Virtual Filesystem**: Owns the VFS dispatcher that maps ChRIS API resources onto Unix-style paths — see [VFS](#virtual-filesystem-vfs) below.

## Architecture: The Sandwich Model

```text
[ ChELL (REPL) ]  [ Chili (CLI) ]  [ Web App ]  [ Mobile App ]
       |                 |               |              |
       +-----------------+---------------+              |
                         |                              |
                         v                              v
              [      Salsa (Logic / Intents)        ]  <-- YOU ARE HERE
                         |
                         v
              [      Cumin (State / Infrastructure) ]
                         |
                         v
              [      @fnndsc/chrisapi (Client)      ]
```

## Key Modules

### Filesystem

| Function | Description |
|----------|-------------|
| `vfsDispatcher` | Routes `list`/`read` calls to the correct VFS provider by path prefix |
| `files_list` | List a directory (paginated) |
| `files_listAll` | Full directory listing (all pages) |
| `fileContent_get` | Read remote file content |
| `files_uploadPath` | Upload a local file or directory tree to ChRIS |
| `files_touch` | Create an empty file |
| `files_mkdir` | Create a directory |
| `files_rm` | Delete a file or directory |
| `files_cp` / `files_mv` | Copy / move |

### Plugins & Store

| Function | Description |
|----------|-------------|
| `plugins_list` / `plugins_listAll` | Fetch plugin list |
| `plugin_checkExists` | Check if a plugin is already registered |
| `plugin_registerWithAdmin` | Register a plugin via the admin endpoint |
| `plugin_assignToComputeResources` | Assign plugin to compute environments |
| `plugins_searchPeers` | Search peer ChRIS stores (e.g. cube.chrisproject.org) |
| `plugin_importFromStore` | Import a plugin from peer store data |
| `plugin_searchPeersByImage` | Resolve a Docker image to a peer-store plugin |

### Feeds & Sub-resources

| Function | Description |
|----------|-------------|
| `feeds_list` / `feeds_listAll` | Fetch feeds |
| `feedNote_get` / `feedNote_update` | Read or update the singleton note on a feed |
| `feedComments_list` | List comments on a feed |
| `feedComment_create` / `feedComment_update` / `feedComment_delete` | Comment CRUD |

### Pipelines & Workflows

| Function | Description |
|----------|-------------|
| `pipelines_list` | List registered pipelines |
| `workflow_create` | Instantiate a pipeline as a workflow on a feed |

### Jobs (Plugin Instance Operations)

| Function | Description |
|----------|-------------|
| `job_cancel(id)` | Cancel a running/scheduled instance (`PUT {status: cancelled}`) |
| `job_delete(id)` | Delete a terminal instance record |
| `job_statusFetch(id)` | Live-fetch current status from API (bypasses cache) |
| `job_logFetch(id)` | Fetch stdout/stderr log for an instance |
| `procCache_refresh([feedID])` | Rebuild the `/proc` job cache, optionally scoped to one feed |

## Virtual Filesystem (VFS)

`vfsDispatcher` translates a ChRIS path into a provider call. Each provider handles a path prefix and maps API resources onto filesystem semantics:

| Path prefix | Provider | Backed by |
|-------------|----------|-----------|
| `/home/<user>/` | `HomeVfsProvider` | ChRIS user-file API |
| `/home/<user>/feeds/` | `FeedVfsProvider` | Feed resources |
| `/bin` | `BinVfsProvider` | Registered plugins (virtual executables) |
| `/usr/bin` | `UsrBinVfsProvider` | Built-in shell commands (`whoami`, `whereami`) |
| `/etc` | `EtcVfsProvider` | Config files (`compute.yaml`, `group`, `passwd`, `cube`) |
| `/net/pacs/queries/` | `PacsVfsProvider` | PACS query results |
| `/proc/jobs/` | `ProcVfsProvider` | Job monitoring DAG (backed by `ProcCache` in cumin) |
| `*.chrislink` | resolved by dispatcher | Symlinks to other ChRIS paths |

Providers implement a common interface: `list(path)` → `Result<VFSItem[]>` and `read(path)` → `Result<string>`.

### `/proc/jobs/` — Job Monitoring

`ProcVfsProvider` mirrors the computation DAG of every visible feed. Each plugin instance is a directory; virtual files inside expose live status, params, and log:

```
/proc/jobs/feed_123/
├── status                  ← aggregate: running | finishedSuccessfully | finishedWithError
├── title
└── pl-dircopy_456/         ← type=job in VFSItem; ls -l shows colour-coded status
    ├── status              ← live API fetch if non-terminal
    ├── params              ← key=value, cached permanently
    ├── log                 ← never cached, always live
    └── pl-fshack_789/
        └── …
```

The cache (`ProcCache` in cumin) holds flat topology maps for O(1) lookup and O(depth) path reconstruction. The daemon restores this normalized graph from an identity-scoped local checkpoint, validates visible feeds, then reconciles it with a paginated CUBE sweep. Terminal status persists; active status and logs remain live.

## Development

### Build

```bash
npm run build
```

### Test

```bash
npm run test
```

## License

MIT — part of the [ChRIS Project](https://chrisproject.org).

---
_-30-_
