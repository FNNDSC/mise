---
"@fnndsc/salsa": minor
---

A path walk over a projection path (`/proc`, `/net/pacs`, `/etc`, `/usr/share`) no longer litters the console with a cumin context-init failure for every ancestor. `files_getGroup` asked the raw CUBE-files layer to build a folder context for each segment while resolving links — `cd` into a `/proc` job did it once per ancestor — and a projection has no CUBE folder, so each attempt failed three lines at a time. The dispatcher now answers `path_isVirtual`, and `files_getGroup` returns "no such group" for a projection path without troubling cumin, since the projection's own provider is what lists it.
