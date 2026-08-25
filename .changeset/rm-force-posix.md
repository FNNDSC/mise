---
"@fnndsc/chili": patch
---

POSIX rm -f semantics: a missing operand under `-f` is success, not an
error, making remove-then-recreate scripts idempotent.
