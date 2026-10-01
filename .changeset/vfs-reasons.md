---
"@fnndsc/brasa": patch
"@fnndsc/calypso": patch
"@fnndsc/argus": patch
"@fnndsc/porter": patch
---

A refused file read says why: the kernel names the status and reason (403 not yours to read, 404 no such file, 502 CUBE could not serve it), `/vfs` answers with them instead of 404 for everything, and an image pane that lost a slice reads the reason out. `porter --end <who>` ends one session so the next login boots on the current kernel.
