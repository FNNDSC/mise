---
"@fnndsc/brasa": patch
---

Lines that run at the same time now keep their own success or failure and their own pipe input, the first step towards a long command no longer holding the session (#1273). Nothing changes yet in what a line does; this is what lets a later change run a read beside a writer, and background jobs beside both.

Each line has its own exit status: `exitCode_set` and `exitCode_read` in `core/handlerRun.ts` replace the 243 writes of `process.exitCode`, and a top-level line runs in `exitScope_run`, which leaves its code as the process's when it ends, so a one-shot `chell -c` exits as before. A pipe segment's piped text and listing are held in slots of their own (`stdinScope_run`, `listingInScope_run`).
