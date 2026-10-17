---
"@fnndsc/salsa": patch
"@fnndsc/cumin": patch
---

A warm `ls`, `cd` or `cat` asks CUBE nothing. Whether a path is a folder comes from the memoised folder lookup, not a fresh listing of its parent; a lookup that found nothing is kept as long as a listing; /etc's compute.yaml and passwd and the /usr/share plugin records are kept. /proc/workflows, which walked every workflow on the CUBE, is unmounted (docs/proc.adoc).
