---
"@fnndsc/brasa": patch
---

Nothing changes at the prompt: the commands that read CUBE themselves register with the ChRIS backend, and the core group keeps only its own (#1001). `tree`, `du`, `edit`, `file`, `xxd`, `strings`, `sha256sum`, `md5sum`, `record`, `play`, `expect` and `motd` join the ChRIS group. Listings, help and completion keep their order. `who` asks the backend for the session's user (`BackendSession.user_get`). `debug` toggles the backend's debugging (`debug_get` returning null before it can say, and `debug_set`), and a backend without one refuses it by name. The lab's `ping` and `chrisfetch` move to `builtins/games/chrislab.ts`. The core group now reaches ChRIS only through the ten file commands.
