---
"@fnndsc/brasa": minor
---

A plugin's parameters tab-complete after `--` on its `/bin` line, full name or bare.

`pl-freesurfer-v1.0.4 --<tab>` offered nothing: only a pipeline's line completed its `--node.field` options. Now the first word is read as a plugin, by its full name or its bare name (the highest version, as the run resolves it), its parameters are fetched once from CUBE as `--parameters` reads them, and `--ex<tab>` gives `--exec`; a boolean parameter completes as its flag alone. A pipeline's line completes as before (#1306).
