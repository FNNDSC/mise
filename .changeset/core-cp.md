---
"@fnndsc/brasa": patch
"@fnndsc/fond": patch
---

Nothing changes at the prompt: `cp` goes through the backend's filesystem (#1001). Into a folder the destination names, the copy keeps its name, decided by the core as mv decides it. The mount's refusal is said once, after one `cp:`. The memory mount refuses a copy of a file onto a folder (EISDIR) or of a folder onto a file (ENOTDIR), as a disk does.
