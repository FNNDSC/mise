---
"@fnndsc/brasa": minor
"@fnndsc/argus": patch
---

`mkdir` follows POSIX: `-p`/`--parents` makes missing parents and accepts an existing folder; without it a missing parent is "No such file or directory" and an existing folder "File exists". `rm` says "Is a directory" for a directory without `-r`, reads `--recursive`/`--force`/`--interactive` whole, and stays silent on `-f` of a missing operand. `mkdir`, `rm`, `cp`, `mv` and `touch` refuse an option they do not have, by name, instead of skipping it or taking it for a path. argus ensures `~/gather` with `mkdir -p`.
