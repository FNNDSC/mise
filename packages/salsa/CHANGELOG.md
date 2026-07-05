# @fnndsc/salsa

## 3.2.6

### Patch Changes

- The PACS VFS content reader parses query folder ids with the same helper as the listing provider; `cat metadata.json` inside `/net/pacs/queries/...` directories works again (it failed with "Invalid query ID in path" on the modern `<desc>_qid:<id>` folder naming).

## 3.2.5

### Patch Changes

- Test coverage lock-in: global coverage ratchets raised and a 60% per-file floor enforced in CI. No runtime changes.
- Updated dependencies
  - @fnndsc/cumin@3.3.0
