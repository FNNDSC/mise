# Work In Progress (WIP)

## Current Status
`chell` is a functional MVP with a modular architecture (`src/core`, `src/session`, `src/builtins`, `src/lib`). It supports interactive REPL usage, command history, autocompletion, and one-shot CLI commands.

## Recently Implemented
- **Command History:** Persist history between sessions to `~/.chell_history`.
- **Autocompletion:** Implemented basic tab completion for built-in commands.
- **Refactoring:** Separated entry point (`index.ts`) from application logic (`chell.ts`) for better testability.
- **Modular Architecture:** Refactored into `core/repl`, `session`, `builtins`, `vfs`.
- **CLI Arguments:** `chell [target] -u user -p pass` allows direct connection on startup.
- **Connection:** Fixed singleton state issues by using `chrisConnection` directly in `chell`.
- **Navigation:**
    - `cd`: Validates path existence against CUBE API.
    - `ls`: Supports relative paths via `chili`'s `path_resolveChrisFs`.
- **Style Compliance:** All `chell` source files fully adhere to `TYPESCRIPT-STYLE-GUIDE.md` (RPN, JSDoc, Explicit Types).
- **Tests:** Added `tests/completer.test.ts` (passing).

## Resolved Issues
- **Prompt State:** Fixed "disconnected" prompt by ensuring `chell` uses the correct `chrisConnection` instance.
- **Module Resolution:** Fixed `TS2307` errors by correcting `chili/package.json` exports and types.
- **Execution:** Fixed `permission denied` by adding `chmod +x` to build artifact.

## Known Issues
- **Tests:** `tests/index.test.ts` fails with `Maximum call stack size exceeded` (likely ESM/Jest config issue with dependencies).

## Next Steps
- **Enhanced VFS:** Expand `/bin` and implement `/feed` or `/home` overlays.
- **Path Autocompletion:** Implement async path completion in `completer`.
- **Fix Tests:** Investigate `index.test.ts` failure.