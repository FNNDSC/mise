---
"@fnndsc/salsa": patch
---

`/proc` synthesized files (a node's `log`, `params`, `status`) now serve their UTF-8 bytes through the binary read path, so byte readers such as the daemon's `/vfs` route see the same content `cat` does.
