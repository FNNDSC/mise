---
"@fnndsc/brasa": patch
---

A `/bin` pipeline refuses an operand beside `--previous=N` as it does beside `--previous N`.

The check matched only the bare word, so the `=` form, before or after the operand, slipped past and the input was said twice (#1313).
