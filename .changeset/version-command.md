---
"@fnndsc/chell": minor
---

Add a `version` command inside the shell. Typing `version` at the chell prompt (or `chell -c version`, and over a CALYPSO daemon via `chell --remote`) now prints the same stack report as `chell --version` — chell plus the chili/salsa/cumin layers — as a typed `sys.version` envelope, instead of falling through to chili as an unknown command. The version-report logic that both `--version` and the boot panel already shared moved into `core/version.ts` so the new command reuses it rather than duplicating the package.json loading.
