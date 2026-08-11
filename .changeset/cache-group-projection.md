---
'@fnndsc/salsa': patch
'@fnndsc/brasa': patch
'@fnndsc/chell': patch
---

Cache the `/etc/group` projection per CUBE connection for five minutes,
invalidate it after ChELL membership changes, and show semantic inspection
progress while an uncached projection is resolving.
