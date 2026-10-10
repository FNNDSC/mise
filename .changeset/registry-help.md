---
"@fnndsc/brasa": minor
"@fnndsc/chell": minor
---

Nothing changes at the prompt: each command group brings its own help, and no backend can replace a core command (#981). The ChRIS commands' help (74 pages, and the resource contract they share) moves to `chris/help.ts` and registers with the ChRIS commands; the core's stays in `builtins/help.ts`. `/usr/bin` and command completion offer only verbs the session can run, as `help` does. `commands_register(group, 'backend')` refuses a group that names a core command; the package entry registers ChRIS that way. The hand-kept `command-keys.ts` goes, and with it the `COMMAND_HANDLERS_KEYS` export of brasa and chell; the registry answers instead.
