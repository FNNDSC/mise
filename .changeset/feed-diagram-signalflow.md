---
"@fnndsc/brasa": minor
---

Add `feed diagram --signalflow <feedId>` — emits a feed's DAG as a **SignalFlow YAML
document to stdout**, composed with pipes rather than rendered in place:

```
feed diagram --signalflow 1669 | signalflow -            # ASCII
feed diagram --signalflow 1669 | signalflow - -o x.svg   # SVG
feed diagram --signalflow 1669 > feed-1669.yaml          # keep it
```

It builds the graph cache-first, collapses isomorphic siblings into named `×N` chips, and
encodes topological-join edges via SignalFlow's node-reuse mechanism. mise emits the
representation only — no renderer is invoked, discovered, or bundled — so there is nothing
to install for the command itself; rendering is the user's own `signalflow`. `--signalflow`
names the dialect, leaving room for further emitters (`--json`, `--dot`, …).
