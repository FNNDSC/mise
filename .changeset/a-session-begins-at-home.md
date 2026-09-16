---
"@fnndsc/brasa": patch
---

A first session begins in the identity's home directory. Before the context had stored a working directory the session answered `/`, which is a place nobody works in; it now answers `/home/<user>`, as a shell would. A stored directory is always honoured, the root included.
