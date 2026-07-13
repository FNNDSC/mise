# @fnndsc/chili

## 3.6.0

### Minor Changes

- e43f42a: Delegating an unknown chell command to chili no longer stalls or floods the terminal with context-init errors when the current directory is a pure-VFS path (`/proc`, `/net`, ...). chili now registers its file-group and plugin-context commands without resolving any ChRIS context — each controller is created lazily, only when a command's action runs — so an unrelated command (or a directory that is not a ChRIS folder) pays no network cost and produces no setup-time error wall. chili also exports `commandNames_get()`, a cheap network-free listing of its top-level commands. In brasa, the "delegating to chili" notice is now emitted on the live sink before chili runs, so it appears ahead of chili's output instead of after it; and a command chili does not know (a typo, a host program) is reported as `command not found` without delegating at all.

## 3.5.0

### Minor Changes

- a0d3df5: chili's command layer no longer prints straight to the console. A new output seam (`screen/output.ts`) routes all command output through a swappable `ChiliWriter` — `chiliLog`/`chiliErrLog`/`chiliWrite` — whose default delegates to the process console, so the standalone CLI is unchanged. A host captures a run's output with `chili_capture(fn)`, and `run_capture(argv)` runs a single command with its output collected as strings, so an in-process host (the brasa engine) can drive chili headless without a console monkeypatch.

## 3.4.0

### Minor Changes

- d69b086: Add sans-I/O rendering variants alongside the existing printing ones, so hosted surfaces can carry command output in an envelope rather than relying on the caller to capture `console.log`: `pluginParameters_manRender` (view), `PluginContextGroupHandler.parameters_listManRender` / `parameters_fieldsRender`, and `BaseGroupHandler.resourceFields_render`. The original printing forms are unchanged and still used by chili's own CLI.

## 3.3.0

### Minor Changes

- asciidoctor 3 → 4 (dependency-free, drops the deprecated glob/inflight chain); the man renderer's `browser_open` is now async. Removed the unused `node-fetch` dependency (Node ≥ 22 global fetch).

### Patch Changes

- Updated dependencies
  - @fnndsc/cumin@3.4.0

## 3.2.6

### Patch Changes

- Test coverage lock-in: global coverage ratchets raised and a 60% per-file floor enforced in CI. No runtime changes.
- Updated dependencies
- Updated dependencies
  - @fnndsc/cumin@3.3.0
  - @fnndsc/salsa@3.2.5
