---
"@fnndsc/brasa": minor
---

Variables: `A=$(cmd)` holds what a command answered and `${A.field}` reads it, so a manifest chains runs by name. `NAME=word` holds one word; a command with no model is held as its text, one operand per line; a failed command leaves the name unchanged and fails the line. `set` lists the variables and `set A` shows one whole; `unset` removes them. A play gets its own scope, its parameters read-only, and `@answers NAME` makes `X=$(play f)` hold that variable's model. `${gather}` is read live by the same field rule (`${gather.series.folderPath}`, `${gather.name}`); `.first`, `.last`, `.size`, `.N` and `.place` are gone (#1208).
