---
"@fnndsc/chili": patch
---

Asking chili for its version now prints the installed version and exits cleanly, through `chili --version`. It said 1.0.1 whatever was installed, then printed a CommanderError stack.
