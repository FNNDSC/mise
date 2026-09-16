---
"@fnndsc/chell": patch
"@fnndsc/brasa": patch
---

A daemon comes up where the operator left it. A credentialed boot used to write `/` into the working-directory context after connecting, so every restart began at the root whatever was stored; it no longer touches the directory, and with nothing stored the kernel's home default (`/home/<user>`, now exported as `homePath_of`) applies to the boot context too.
