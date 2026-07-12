# @fnndsc/chili

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
