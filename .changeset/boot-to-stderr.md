---
"@fnndsc/chell": patch
---

A `chell -c` command's output is now only its answer, even when the session had to be started first. The session's start-up progress, and the notices that the daemon changed or disconnected, go to stderr, so a script or agent reading stdout no longer gets a boot log before the result.
