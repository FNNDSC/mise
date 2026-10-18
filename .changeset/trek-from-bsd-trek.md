---
"@fnndsc/brasa": patch
---

The session's trek game now comes from bsd-trek, the same port published on its own for anyone to play in a terminal.

The BSD trek(6) engine moved out of brasa into `packages/trek`, published as `bsd-trek` (`npx bsd-trek`). brasa's `trek` builtin is now the session's terminal and saved-game slot over that package, with the same flags and the same game; brasa no longer carries the trek NOTICE, which travels with `bsd-trek` as its BSD-3-Clause licence.
