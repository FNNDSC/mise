---
"@fnndsc/brasa": patch
---

Nothing changes at the prompt: why a pipe never runs a bare plugin name is written down (#981). Running a /bin plugin starts a CUBE job; typed at the prompt it does, inside a pipe or a redirect it does not, so a pipeline of words never starts a job as a side effect.
