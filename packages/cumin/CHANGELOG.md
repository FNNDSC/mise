# @fnndsc/cumin

## 3.3.0

### Minor Changes

- Route all chrisapi access through a single adapter seam (`src/chrisapi/adapter.ts`). The public API is unchanged; responses whose `data` payload is missing now surface as errors instead of propagating `undefined`. Enforced repo-wide by a new `lint:seam` CI check.
