# @fnndsc/salsa

## 3.3.0

### Minor Changes

- 0d358c5: /proc now caches settled job status. A finished plugin instance
  (`finishedSuccessfully`, `finishedWithError`, `cancelled`) never changes, so its
  status is kept permanently once observed. Consequences:

  - Listing a fully-finished feed under `/proc/jobs` is instant — no status calls.
  - Live status for active feeds is refreshed with a single feed-scoped list call
    (the list response already carries `status`) instead of one detail fetch per node.
  - Reading a settled instance's `status` returns the cached value without an API call.

### Patch Changes

- Updated dependencies [0d358c5]
  - @fnndsc/cumin@3.6.0

## 3.2.6

### Patch Changes

- The PACS VFS content reader parses query folder ids with the same helper as the listing provider; `cat metadata.json` inside `/net/pacs/queries/...` directories works again (it failed with "Invalid query ID in path" on the modern `<desc>_qid:<id>` folder naming).

## 3.2.5

### Patch Changes

- Test coverage lock-in: global coverage ratchets raised and a 60% per-file floor enforced in CI. No runtime changes.
- Updated dependencies
  - @fnndsc/cumin@3.3.0
