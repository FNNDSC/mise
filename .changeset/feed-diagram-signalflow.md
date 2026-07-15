---
"@fnndsc/brasa": minor
---

Add `feed diagram <feedId>` — renders a feed's DAG as a SignalFlow diagram written to a
host file (ASCII by default, `--svg` for SVG; `--out <path>`, `--stdout`). Builds the
graph cache-first, collapses isomorphic siblings into named `×N` chips, and draws
topological-join edges via SignalFlow's node-reuse mechanism. SignalFlow is an optional,
replaceable rendering leaf: discovered via `SIGNALFLOW_BIN` or `PATH`, and when absent the
command degrades gracefully to a pointer at `feed tree` rather than failing.
