---
"@fnndsc/fond": minor
"@fnndsc/salsa": patch
---

Nothing changes for chell, ARGUS or porter users: the virtual filesystem's contracts and dispatcher now live in fond. fond's dispatcher knows no backend; salsa's CubeVfsDispatcher registers CUBE's mounts on it in the same order, so every path routes as before.
