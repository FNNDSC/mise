---
"@fnndsc/brasa": minor
---

A path tab-completes after a `/bin` plugin or pipeline name, where its operand goes.

With #1303 a `/bin` run takes an input operand, and `pl-freesurfer ~/up<tab>` offered nothing: a path completed only after a fixed list of file commands. Now the first word is asked of the session: a plugin `name-vVersion`, a bare plugin name, or a pipeline by its `/bin` name or its own name takes paths, and its operand completes as `ls` and `cp` do. Only operand positions complete: an option word does not, and the word after `as` is a subject's name (#1305).
