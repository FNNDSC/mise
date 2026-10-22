---
"@fnndsc/brasa": patch
---

Following a task now starts with its last lines, as tail -f does, so nothing it said before you attached is lost. A backend can reach the runner and the command's cancellation through `@fnndsc/brasa/core`.
