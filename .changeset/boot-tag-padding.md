---
"@fnndsc/chell": patch
---

fix(boot): the boot readout's label column stops moving with the status

Status tags are not all the same width — `[RETRY]` is a character wider than `[ OK ]` — and only the label was padded, so a retry row's label and message sat one column right of every other row's.

Tags now come from a table and are padded to the width of the widest, with the padding applied to the bare text before colour, since padding a colour-wrapped string counts the escape sequences instead of the visible characters. The width is derived from the table rather than written down, so a longer status added later widens every row together instead of shunting one label out of line.
