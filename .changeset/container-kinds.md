---
"@fnndsc/fond": minor
"@fnndsc/brasa": patch
---

A backend's container kinds are folders to every tool.

cd, ls of a file, and a read that fails on a folder decided folder-ness by naming item types (dir, vfs, job). A backend's listing look already says which of its kinds hold other items; the tools now ask it, through fond's itemType_isContainer and a container test the dispatcher is told at engine creation. A ChRIS session is unchanged: its jobs were already containers in its look. A stratus session can now cd into a compartment.
