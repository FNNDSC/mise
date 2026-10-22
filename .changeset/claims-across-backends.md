---
"@fnndsc/brasa": minor
"@fnndsc/stratus": minor
---

Every session can play a manifest and make claims again: each backend registers what can be claimed about its world. `expect` keeps its grammar, `--within` and `path exists|count` in the core; ChRIS registers `gather`, `feed`, `run` and `path … tags`, and stratus registers `domain` (`step <name>`, `verify`, `class`, `cost`), so a tenant's manifest can assert its domain. `play` reads a manifest through the backend's files, then the engine's disk. A play no longer stops at its first line when an earlier command in the session had failed: each line is judged on its own status (#1056, stratus.adoc D14).
