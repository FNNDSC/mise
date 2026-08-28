---
'@fnndsc/chell': patch
---

The boot animation no longer paints over long output.

The pulse repaints the logo by moving the cursor up a fixed number of rows, and
it counted rows by counting newline characters. A line longer than the terminal
is wrapped into several screen rows while contributing one newline, so the
count under-shot and the animation painted on top of whatever had been printed.

The daemon banner made it plain: its identity line and its ARGUS URL, which
carries a 64-character token, both wrap — and both were the lines that came out
mangled.

Rows are now counted as rows, with escapes stripped so cursor and colour codes
do not inflate a width, and with the column position carried across writes that
do not end in a newline.
