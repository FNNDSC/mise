# @fnndsc/cumin

## 3.4.0

### Minor Changes

- The typed payload extractors (`listData_get`, `itemData_get`, `items_get`) and common chrisapi types (`PluginInstance`, `Feed`, `FileBrowserFolder`, ...) are re-exported from the package index. The `chrisConnection` singleton is now initialized in place instead of reassigned, fixing stale named-import bindings in ESM consumers.

## 3.3.0

### Minor Changes

- Route all chrisapi access through a single adapter seam (`src/chrisapi/adapter.ts`). The public API is unchanged; responses whose `data` payload is missing now surface as errors instead of propagating `undefined`. Enforced repo-wide by a new `lint:seam` CI check.
