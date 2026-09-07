---
"@fnndsc/cumin": patch
"@fnndsc/salsa": patch
"@fnndsc/brasa": patch
---

fix: no write goes to a path the store already holds

A write onto an occupied path leaves a row CUBE's own API cannot serve, and one such row makes **every** listing of that folder fail — the damage first seen as "the home root cannot list its files". It is reproducible in three commands, and all three ordinary write routes did it:

* `mv a b` where `b` exists — its own PUT of `upload_path`.
* `cp a b` where `b` exists — the copy uploads to an occupied name, and reported *success* while doing it.
* `upload a.txt` where `a.txt` exists — and this is the one that made the original rows. CUBE renames a colliding upload (`a.txt` → `a_VlIxMSp.txt`); mise then PUT the wanted path back onto the file, to undo a rename it read as spurious. That PUT is the damage.

Each route now asks first, which costs one listing call and keeps the folder readable:

* `mv` and `cp` refuse by name — `Destination exists: <path> — mise cannot overwrite a file; remove it first` — and a failed move or copy now reports the kernel's own reason instead of a bare `Failed to move` / `Failed to copy`.
* `upload` renames back only when the wanted path is genuinely free, which is the case that rule was written for (a path deleted and not yet committed). Otherwise it keeps the name CUBE gave the file and says so: `'<path>' already exists — the upload landed as '<other>' rather than overwriting it`. A probe that cannot answer counts the path as taken, since the cost of guessing wrong is the operator's folder.

The deliberate replace (`--csv-to --force`) is unaffected: it removes the file, waits for the path to stop resolving, then writes to a path that is free.

`docs/CUBE-gaps.adoc` carries the reproduction, the mechanism and the client policy; upstream is ChRIS_ultron_backEnd#732.
