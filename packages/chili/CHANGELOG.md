# @fnndsc/chili

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
