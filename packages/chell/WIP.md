# Work In Progress (WIP)

## Current Status
`chell` is a functional MVP with basic REPL capabilities, connection management, and filesystem navigation.

## Recently Implemented
- **Core REPL:** `readline`-based loop with customizable prompt.
- **Connection:** Direct integration with `@fnndsc/cumin`'s `chrisConnection` to handle login/logout within the shell process.
- **Navigation:**
    - `cd`: Validates path existence against CUBE before changing context.
    - `pwd`: Prints current ChRIS context path.
    - `ls`: Lists files in the current context or relative paths (using `chili`'s `chefs_ls_cmd` and `path_resolveChrisFs`).
- **Fallback:** Unrecognized commands are proxied to `chili` as a child process.
- **VFS:** `/bin` virtual directory lists available plugins.

## Known Issues / Todos
- **Prompt State:** The prompt sometimes displays `disconnected@no-cube` even after a successful connection in certain test environments. This might be due to state synchronization or output buffering issues.
- **Output Visibility:** In non-interactive piped tests, standard output from commands might be suppressed or interleaved unexpectedly.
- **Error Handling:** API errors (e.g., 404 on `cd`) are caught and logged, but could be more user-friendly.
- **Argument Parsing:** The `processCommandArgs` function is rudimentary and does not support complex flag parsing as robustly as `commander`.

## Next Steps
- Debug prompt state persistence.
- Enhance argument parsing (possibly using `commander` inside the REPL loop).
- Expand VFS to cover more ChRIS resources.
