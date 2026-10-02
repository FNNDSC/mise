---
"@fnndsc/argus": patch
---

Focus names a pane on stage: after a preset change the layout's focus could still name a pane that had left (the launcher), so the HELP tile and `pane split` from the focused pane opened nothing (#816). A tree that loses the focused pane now hands focus to its first leaf.
