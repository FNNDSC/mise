---
"@fnndsc/brasa": minor
---

brasa: a row can be named by its number.

An operator reads a listing and wants the third row. Saying which row meant repeating its address — for a PACS series, a line of text nobody types by hand — so acting on what you can see was a surface gesture, and a scripted session could not do it at all.

Now a command that answers with rows records them as the session's last answer, and `@3` names one: `gather add @2,3,6`, `image @1`, `gather remove @15,16`. Lists and ranges read as they look (`@2-4`), and because the index is resolved by the one expander, every verb takes one without knowing anything about it.

What gets numbered is the MODEL, not a rendering of it, so a console table and a graphical pane count the same rows — an index that meant different things on different surfaces would be worse than no index. What a row is worth is declared per listing (`fs.listing` and a PACS answer give paths; the cohort gives its members' paths), so a verb receives the operand it already takes.

The sigil is what keeps it honest: a directory called `2` is a path and `@2` never is, `'@2'` in quotes is text, and `user@host` is not an index because only a number at the start of a word is one. A line that acts on a number says which listing it counted (`from: ls ~/uploads · 7 rows`), and a number past the end refuses with how many rows there are rather than acting on the wrong one. An answer with no rows does not replace one that has them: an empty `ls` should not un-number the listing just read.

Numbering lives as long as the session, so at a daemon it spans commands and at `chell -c` it spans the one line — `ls ~/uploads; gather add @1` is the one-shot form.
