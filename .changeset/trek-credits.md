---
"bsd-trek": minor
"@fnndsc/brasa": patch
---

trek shows its credits with `credits` in the game and `trek --credits`, and Ctrl-C ends a game cleanly.

`credits` at the `Command:` prompt and `trek --credits` (in a terminal and in mise's session) name the game's authors as the C's own credits do, the TypeScript port by Rudolph Pienaar, and mise and ChRIS. The command is the port's, last in the command table, and takes no time. Ctrl-C in the `bsd-trek` command now ends the game at once with status 130, as the original's interrupt did, instead of a readline stack trace.
