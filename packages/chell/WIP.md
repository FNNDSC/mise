# Work In Progress (WIP)

## Current Status
`chell` is a functional MVP with a modular architecture (`src/core`, `src/session`, `src/builtins`, `src/lib`). It supports interactive REPL usage and one-shot CLI commands via `chili` fallback.

## Recently Implemented
- **Modular Architecture:** Refactored into `core/repl`, `session`, `builtins`, `vfs`.
- **CLI Arguments:** `chell [target] -u user -p pass` allows direct connection on startup.
- **Connection:** Fixed singleton state issues by using `chrisConnection` directly in `chell`.
- **Navigation:**
    - `cd`: Validates path existence against CUBE API.
    - `ls`: Supports relative paths via `chili`'s `path_resolveChrisFs`.
- **Style Compliance:** All `chell` source files fully adhere to `TYPESCRIPT-STYLE-GUIDE.md` (RPN, JSDoc, Explicit Types).
- **Tests:** Added `tests/index.test.ts` and `jest` configuration (ESM support).

## Resolved Issues
- **Prompt State:** Fixed "disconnected" prompt by ensuring `chell` uses the correct `chrisConnection` instance.
- **Module Resolution:** Fixed `TS2307` errors by correcting `chili/package.json` exports and types.
- **Execution:** Fixed `permission denied` by adding `chmod +x` to build artifact.

## Next Steps
- **Autocompletion:** Implement tab completion for paths and plugins.
- **Command History:** Persist history between sessions.
- **Enhanced VFS:** Expand `/bin` and implement `/feed` or `/home` overlays.