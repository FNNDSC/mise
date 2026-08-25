---
"@fnndsc/brasa": minor
"@fnndsc/cumin": patch
---

Typed chell API, third tranche: `cp` and `mv` join the facade with their
existing `fs.cp`/`fs.mv` models. Fixing what their first typed run
surfaced: file rename was silently broken against current CUBEs (the PUT
field drifted from `path` to `upload_path`); cumin now sends the current
field and falls back for older servers.
