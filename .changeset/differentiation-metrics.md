---
'@fnndsc/cumin': minor
'@fnndsc/salsa': minor
'@fnndsc/brasa': patch
---

Execution metrics ride the warmup for free: node differentiation lands.

Every CUBE plugin-instance list row already carries `start_date`,
`end_date`, and `size` — the same rows warmup and status refresh page
through. They are now typed on the contract, captured into the proc cache
(`ProcInstance.startedAt/finishedAt/outputBytes`, merged defined-only so a
refresh never erases what warmup saw), persisted by the checkpoint, and
projected by `feed diagram` onto each node's `metrics` (wall-clock
`computeSeconds`, `dataBytes`). Zero new CUBE calls at any point.

The molecule rendering scales by them (a SCALE pill flips between wall
time and output bytes, re-projecting the remembered model locally), and
timestamp-true pulse replay becomes possible.
