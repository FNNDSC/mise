# Work In Progress (WIP)

## Current Status
`chell` is a functional MVP with a modular architecture (`src/core`, `src/session`, `src/builtins`, `src/lib`). It acts as a direct consumer of the `chili` library for all its commands, removing the previous reliance on spawning child processes. All unit tests are currently passing.

## Recently Implemented
- **Full In-Process Command Execution:**
    - `chell` now directly imports and executes commands (e.g., `ls`, `cd`, `connect`, `upload`, `plugin`, `feed`, `files`, `links`, `dirs`) from the `chili` library.
    - Eliminated process spawning for core commands, significantly improving performance and integration.
- **Unified Command/View/Model Architecture:**
    - `chell` utilizes shared command logic and presentation (`render*` views) provided by `chili`, ensuring consistent behavior and output across both the `chili` CLI and the `chell` REPL.
    - All commands adhere to the strict typing guidelines, using `src/models` from `chili` where applicable.
- **Enhanced `ls` Functionality:**
    - `ls` command now supports `-l` (long listing), `-h` (human-readable sizes) and `/bin` virtual directory (for plugins).
    - Generic output options (`--table`, `--csv`) are now available for listing commands.
- **New `upload` Command:**
    - Implemented a robust `upload <local_path> <remote_path>` command, supporting recursive directory uploads from the local filesystem to ChRIS.
- **Improved Plugin Management:**
    - `plugin list` and `plugin run` commands are now fully integrated and callable in-process.
- **Improved Feed Management:**
    - `feed list` and `feed create` commands are now fully integrated and callable in-process.
- **File/Link/Dir Management:**
    - Added builtin support for `files`, `links`, and `dirs` commands with native `list` and `fieldslist` subcommands.
    - Unhandled subcommands (delete, share) automatically fall through to `chili` with informative messaging.
- **Color Configuration System:**
    - Implemented YAML-based color configuration for file system types (`colors.yml` in `chili`).
    - Added `vfs` type to distinguish virtual directories like `/bin` from regular directories.
    - VFS directories now display in cyanBright, regular dirs in cyan, plugins in green, etc.
    - Color configuration properly resides in `chili` (view layer), not `cumin` (infrastructure layer).

## Resolved Issues
- **Data Retrieval:** Fixed `Unknown object context type` error by correctly instantiating `ChRISFeedGroup` in `salsa`.
- **Command Dispatch:** Resolved issues with `chili` module import paths (`dist/` vs. co-located types).
- **Previous `ls` Refactoring:** Successfully consolidated `ls` logic into `chili` and removed duplication in `chell`.
- **Typing Strictness:** Ensured pervasive and explicit typing across all refactored code.
- **Tests:** All unit tests are passing.
- **Architectural Layering:** Moved color configuration from `cumin` (infrastructure) to `chili` (view layer) to respect layer separation.
- **VFS Type System:** Added `vfs` type to `ListingItem` model and updated VFS to properly mark virtual directories.
- **js-yaml Import:** Fixed CommonJS/ESM interop issue with js-yaml by using default import pattern.

## Known Issues
- None currently tracked.

## Next Steps
- **Enhanced VFS:** Implement `/feed` virtual directory to navigate feeds as filesystems.
- **Path Autocompletion:** Implement async path completion in `completer`.
- **Audit:** Final audit of `chili`, `chell` (beyond builtins), and `salsa` for strict typing and RPN naming (especially legacy code not touched in refactor).