# Exemplars — live-CUBE reference programs

Working, style-guide-conformant programs that exercise a **live CUBE** end
to end. They are simultaneously:

- **integration tests** — the unit suites mock every CUBE boundary; these
  validate the real contract (chrisapi behavior, PACS timing, job states);
- **reference code** — each is a worked example of how to program the
  sandwich, at two altitudes: the TypeScript API (`ts/`) and the chell CLI
  (`chell/`).

They are **not** part of `npm test` and never run in per-PR CI.

## The invariant

Every exemplar restores the CUBE to its pre-run state: feeds and scratch
files are deleted, PACSQueries removed, and pulled DICOM series folders
deleted (or re-pulled, when they existed before the run). PACS folders are
owned by the CUBE admin, so cleanup needs admin credentials.

## Configuration

| variable | required | meaning |
|---|---|---|
| `CUBE_URL` | yes | API base, e.g. `http://cube:8000/api/v1/` |
| `CUBE_USER` / `CUBE_PASSWORD` | yes | regular test user |
| `CUBE_ADMIN_USER` / `CUBE_ADMIN_PASSWORD` | for 03/04 | admin, PACS-folder cleanup only |
| `CUBE_PACS` | no (default `PACSDCM`) | PACS server identifier |
| `CUBE_TEST_ACCESSION` | no (default `22548684`) | designated test study |

Missing required variables → the program prints a note and exits **2**
(skipped, not failed). Config is isolated to a temp directory per run —
your real chell session is never touched.

## TypeScript exemplars

```
npm run exemplars:build          # once, from packages/chell
node exemplars/ts/dist/01_connect.js
node exemplars/ts/dist/02_fsRoundtrip.js
node exemplars/ts/dist/03_feedDcm2niix.js   # pull → dircopy → dcm2niix → verify .nii → cleanup
node exemplars/ts/dist/04_pacsQR.js         # query → pull → verify → delete/restore → cleanup
```

Each prints ✓/✗ per check and exits 0 only if all passed.

## chell exemplars

Connect once, then run the scripts against the established session:

```
chell "$CUBE_USER@$CUBE_URL" -p "$CUBE_PASSWORD" -c version
chell -e -f exemplars/chell/10_fs_roundtrip.chell
chell -e -f exemplars/chell/20_pacs_qr.chell
chell -e -f exemplars/chell/30_feed_tour.chell
```

`-e` (stop on error) makes script completion itself the assertion. Caveats:

- **20** leaves pulled PACS files behind — chell has no admin credentials.
  Follow with the cleanup phase of TS exemplar 04, or delete the series
  folder as the CUBE admin.
- Static scripts cannot capture ids between commands, so the full
  feed+dcm2niix workflow is TS-only (03); script 30 is a read-only tour.

## Known upstream quirks (found by these exemplars)

- Re-pulling a series through chell's `pull` fails with "retrieve(s) failed
  to start" when a synthetic `pull_<SeriesInstanceUID>` PACSQuery already
  exists from an earlier pull. Workaround: `pacsretrieve pull <queryId>` on
  the existing query, or delete the stale query. The TS exemplars sidestep
  this by tagging query titles with a per-run id.
- A `query` with zero matches exits 1 with no output in `-c` mode.
- A fresh connect (`chell user@url -p pw`) combined with `-c`/`-f` in the
  same invocation leaves cumin's IO layer uninitialized ("ChRIS client is
  not initialized") — connect first, then run commands against the stored
  session.
- `-e` (stop on error) does not abort `-f` scripts on a failed command,
  and the process exits 0 even when commands failed.
