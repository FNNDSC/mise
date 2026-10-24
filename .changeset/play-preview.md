---
"@fnndsc/brasa": patch
---

A dry run of a manifest now previews the lines the play would run (#1241). A capture `R=$(gather process … --title "${LABEL}")` is shown around the command it holds, where the preview used to split it as plain words and put the closing `)` inside the title.

A reference the manifest itself changes before it is used stands as written instead of being filled from the session as it was before the play: `${gather}` after a `gather` or `pull` line, `${cwd}` after a `cd`, an `@` index or `${listing}` after any line, a variable the manifest assigns, and anything after a nested `play`. The preview used to name the cohort the session held before the manifest's own `gather clear`, so `pull ${gather}` showed folders the play would never fetch. A `ReferenceSource` says which verbs change it with `changedBy`; one that does not is held after any line. An `@` index that stands in a preview stands as `@SER3`, not `${@SER3}`.
