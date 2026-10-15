---
"@fnndsc/argus": patch
---

A listing's columns give way when the pane is too narrow, instead of running under the frame's edge (#1067). The lowest-ranked columns stand aside until the rest fit, the bar says how many, and a wider pane brings them back. In RUNS, NODES goes first, then TIME, SIZE, OWNER and PROGRESS; ID, TITLE, STATUS and CREATED always stay. FILES and PACS do the same. The black square no longer covers the last column.
