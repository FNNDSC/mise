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

Instance-specific test data — URLs, logins, and above all the designated
test accession — is **never committed**: accession numbers and DICOM UIDs
are identifiers. It lives in `exemplars/e2e.config.json` (gitignored; copy
`e2e.config.example.json` and fill it in). Real environment variables
override the file, which is how CI injects its secrets.

| key | required | meaning |
|---|---|---|
| `CUBE_URL` | yes | API base, e.g. `http://cube:8000/api/v1/` |
| `CUBE_USER` / `CUBE_PASSWORD` | yes | regular test user |
| `CUBE_ADMIN_USER` / `CUBE_ADMIN_PASSWORD` | for 03/04 | admin, PACS-folder cleanup only |
| `CUBE_PACS` | no (default `PACSDCM`) | PACS server identifier |
| `CUBE_TEST_ACCESSION` | yes | designated test study on YOUR instance |
| `CUBE_TEST_SERIESDESC` | scripts | a small series' description in that study |
| `CUBE_DCM2NIIX_VERSION` | no | pin when the newest build is broken |

Missing required values → the program prints a note and exits **2**
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

chell expands `$VAR` / `${VAR}` environment references in command
arguments, so the scripts carry no instance data. Export your config,
connect once, then run against the established session:

```
. exemplars/e2e-env.sh          # exports exemplars/e2e.config.json
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

## Bugs found by these exemplars (all fixed)

The first live runs surfaced five real defects, since fixed in the same
change set — the argument for keeping live exemplars around:

1. chell `pull` could not re-pull a series (synthetic query title
   collision) — titles now carry a timestamp.
2. A failed `query` exited silently in `-c` mode — it now prints the
   error stack.
3. A fresh connect combined with `-c`/`-f` in one invocation left cumin's
   IO layer uninitialized — cumin's connection singleton is now
   initialized in place instead of reassigned.
4. `-e` did not abort `-f` scripts on failed commands — builtins report
   through `process.exitCode`, which the script loop now honours.
5. cumin's reassigned `export let chrisConnection` broke ESM consumers
   (stale named-import bindings) — same in-place fix as 3.

Note: pl-dcm2niix needs its canonical arguments (see `DCM2NIIX_PARAMS` in
exemplar 03); bare defaults fail on typical series. The newest registered
build is not always the working one — on ekanite v2.0.0 fails where
v1.0.2 succeeds — so pin with `CUBE_DCM2NIIX_VERSION` (in CI: the
`CUBE_DCM2NIIX_VERSION` repo variable).
