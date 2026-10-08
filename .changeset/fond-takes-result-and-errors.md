---
"@fnndsc/cumin": patch
---

Nothing changes for chell, ARGUS or porter users: cumin takes Result and errorStack from the new @fnndsc/fond. It re-exports both, so every import still works, and the error stack stays one shared instance. The login probe export is renamed `url_probe` (was `urlProbe`) to follow the naming convention.
