---
"@fnndsc/chell": patch
---

Align the `pacs pull` per-series progress bars. The series name and status are now rendered as fixed-width columns — the name column grows to the widest series and already-drawn bars (including finished ones) re-pad to match — so every progress bar starts at the same column and the bars line up vertically instead of stepping in and out with each series' name and status length.
