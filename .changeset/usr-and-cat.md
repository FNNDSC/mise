---
"@fnndsc/fond": patch
"@fnndsc/brasa": patch
---

Listing `/usr` exits 0, and `cat` ends a file with its own newline (#1032, #1033). A folder holding only mounts had listed them and still failed, because the store's "nothing here" was left on the error stack. cat had added a newline to every file, so one ending in a newline printed a blank line after it and `cat f > out` wrote a longer file; it now adds one only to a file without.
