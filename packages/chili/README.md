```
  ____ _     ___ _     ___
 / ___| |__ |_ _| |   |_ _|
| |   | '_ \ | || |    | |
| |___| | | || || |___ | |
 \____|_| |_|___|_____|___|
```
**ChILI handles Intelligent Line Interactions**

`chili` is both a standalone CLI and a reusable library for interacting with the ChRIS ecosystem. It serves as the controller layer in the ChRIS interface stack, bridging raw business logic (`salsa`) and user presentation.

## Installation

Install globally to use the `chili` command:

```bash
npm install -g @fnndsc/chili
chili --help
```

Requires Node.js ≥ 20.12. See [Quick Start](#quick-start) for usage.

`chili` is also consumed as a library (e.g. by [`chell`](https://github.com/FNNDSC/chell)): its headless **Commands** return typed **Models**, free of presentation concerns.

```bash
npm install @fnndsc/chili
```

## Abstract

Designed for developers and power-users who want to script and control a ChRIS instance from the terminal. Maintains a persistent local context: connection details, active user, and current ChRIS working directory survive across invocations.

## Architecture: The Sandwich Model

`chili` implements the controller layer:

1.  **`chili` (Library & CLI)**:
    *   **Commands (`src/commands`)**: Headless controllers that execute logic via `salsa` and return typed **Models**. Consumed directly by `chell`.
    *   **Models (`src/models`)**: Explicit interfaces (`Plugin`, `Feed`, `ListingItem`, etc.) defining data structures.
    *   **Views (`src/views`)**: Pure functions that render Models into formatted strings and tables.
    *   **CLI (`src/index.ts`)**: Commander.js entry point orchestrating Commands and Views.
2.  **[`salsa`](https://github.com/FNNDSC/salsa) (Logic)**: Shared Application Logic and Service Assets — high-level business intents.
3.  **[`cumin`](https://github.com/FNNDSC/cumin) (Infrastructure)**: State and connection layer — authentication, context persistence, low-level API.

## Development

`chili` lives in the [`mise` monorepo](https://github.com/FNNDSC/mise) alongside
`cumin`, `salsa`, and `chell`. Build the whole stack from the repository root —
npm workspaces links the four packages together, so there is nothing to clone or
hand-link:

```bash
git clone https://github.com/FNNDSC/mise
cd mise
make taco            # scrub → prep → cook → taste → serve (the full course)
```

### Individual steps (run from the repo root)

| Target | Action |
|--------|--------|
| `make prep` | `npm install` — install deps and link all four workspaces |
| `make cook` | Build (compile TypeScript) all packages in dependency order |
| `make taste` | Run the full test suite |
| `make serve` | Link `chell` globally |
| `make scrub` | Clean build artifacts and `node_modules` |

To build or test just this package: `npm run build -w @fnndsc/chili` /
`npm test -w @fnndsc/chili`.

> Use [NVM](https://github.com/nvm-sh/nvm) and Node 22.x to avoid needing `sudo`
> for the global link in `make serve`.

## Core Features

- **Context-Aware**: Remembers active server, user, and working directory between invocations.
- **Library Mode**: Exports strictly-typed commands and views consumed by `chell` and other frontends.
- **Resource Commands**: Full CRUD for plugins, feeds, files, links, pipelines, compute resources, groups, tags, and more.
- **Plugin Management**: Search, install (from peer store or Docker), and register plugins.
- **Feed Sub-resources**: Notes and comments on feeds (create, read, update, delete).

## Quick Start

**Connect to ChRIS:**
```bash
chili connect <URL> --user <USERNAME> --password <PASSWORD>
```

**Plugins:**
```bash
chili plugins list
chili plugins list --search "name:pl-dircopy"
chili plugin run pl-dircopy-v2.1.0 --args "..."
```

**Feeds:**
```bash
chili feeds list
chili feeds list --user rudolphpienaar
chili feed note 42
chili feed comments 42
```

**Store / plugin install:**
```bash
chili plugins add pl-fshack               # auto-discovers compute resources
chili plugins add pl-fshack --compute ares,argentum
```

**Files:**
```bash
chili files list --path /home/user/uploads
```

## License

MIT — part of the [ChRIS Project](https://chrisproject.org).

---
_-30-_
