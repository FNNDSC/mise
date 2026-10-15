---
"@fnndsc/brasa": patch
---

Run the system's own program instead of chell's with `command`, as in any POSIX shell. `query … | command grep -i t1` is plain text grep with no listing handling, and `command -v grep` answers as the host shell does.
