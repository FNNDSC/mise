# Work In Progress (WIP)

## Current Status
`chell` is a functional MVP with a modular architecture (`src/core`, `src/session`, `src/builtins`, `src/lib`). It features a Virtual File System (VFS) for plugins, robust connection handling, and utilizes a shared library architecture (`cumin`, `salsa`, `chili`) for core operations.

## Recently Implemented
- **Pagination Architecture:**
    - Refactored pagination logic from `chell` into `cumin`'s base `ChRISResource` class (`resources_getAll`).
    - Enabled "fetch all" capability for all CUBE resources across the stack.
    - Updated `salsa` and `chili` to leverage this shared logic, removing duplication.
- **Virtual File System (VFS):**
    - Implemented `/bin` virtual directory listing available plugins.
    - Added plugin version display in `ls`.
    - Integrated generic pagination for retrieving full plugin lists.
- **Prompt & UX:**
    - Updated prompt to show full URI (cyan) and current user/path.
    - Fixed connection protocol handling (auto-prepend `http://`).
- **Command History:** Persist history between sessions to `~/.chell_history`.
- **Autocompletion:** Implemented basic tab completion for built-in commands.
- **Refactoring:** Separated entry point (`index.ts`) from application logic (`chell.ts`) for better testability.

## Resolved Issues
- **Data Retrieval:** Fixed `Unknown object context type` error by instantiating `ChRISPluginGroup` directly.
- **Connection:** Fixed `Cannot read properties of undefined (reading 'context_set')` by ensuring proper `ChRISConnection` initialization.
- **Prompt State:** Fixed "disconnected" prompt by ensuring `chell` uses the correct `chrisConnection` instance.
- **Execution:** Fixed `permission denied` by adding `chmod +x` to build artifact.

## Known Issues
- **Tests:** `tests/index.test.ts` fails with `Maximum call stack size exceeded` (likely ESM/Jest config issue with dependencies).

## Next Steps
- **Enhanced VFS:** Implement `/feed` virtual directory to navigate feeds as filesystems.
- **Path Autocompletion:** Implement async path completion in `completer`.
- **Fix Tests:** Investigate `index.test.ts` failure.