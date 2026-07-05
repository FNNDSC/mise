# @fnndsc/chell

## 4.3.0

### Minor Changes

- chell expands `$NAME` / `${NAME}` environment references in command arguments, making scripts parameterizable. `--version` now reports the chili/salsa/cumin versions in use. Fixes: `pull` re-pull of a series (query title collision), `pull` with a query expression (CWD was corrupting the first DICOM key), silent `query` failures now print the error stack, and `-e` aborts `-f` scripts with a non-zero exit when a command fails. New `exemplars/` reference programs and scripts (repo only, not packaged).

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fnndsc/chili@3.3.0
  - @fnndsc/cumin@3.4.0

## 4.2.12

### Patch Changes

- Test coverage lock-in: global coverage ratchets raised and a 60% per-file floor enforced in CI. No runtime changes.
- Updated dependencies
- Updated dependencies
  - @fnndsc/cumin@3.3.0
  - @fnndsc/salsa@3.2.5
  - @fnndsc/chili@3.2.6
