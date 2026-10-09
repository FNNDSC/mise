---
"@fnndsc/brasa": patch
---

A missing path is now said to be missing by `tree`, `du` and `ls -d`, and unknown options are refused by name. `tree ~/nowhere` says `No such file or directory` instead of drawing an empty tree, and `tree -L 1` or `tree --bogus` are refused by name. `--bogus` used to scan the whole home folder. `du ~/nowhere` refuses instead of printing 0. `du -d 1` and `-dN` take the depth instead of measuring a folder named `1`. `ls -d ~/nowhere` refuses instead of showing `nowhere/`. An empty folder's tree shows the folder. `ls -d /proc/jobs` no longer exits 1.
