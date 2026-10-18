# bsd-trek

## 0.3.0

### Minor Changes

- 5c49254: trek shows its credits with `credits` in the game and `trek --credits`, and Ctrl-C ends a game cleanly.

  `credits` at the `Command:` prompt and `trek --credits` (in a terminal and in mise's session) name the game's authors as the C's own credits do, the TypeScript port by Rudolph Pienaar, and mise and ChRIS. The command is the port's, last in the command table, and takes no time. Ctrl-C in the `bsd-trek` command now ends the game at once with status 130, as the original's interrupt did, instead of a readline stack trace.

## 0.2.0

### Minor Changes

- 313d1f7: bsd-trek keeps the C's names for ported code and names everything the port added object_verb, all of it documented.

  Functions ported from NetBSD's C keep the C's names (`dowarp`, `getcodpar`), so the port reads side by side with its source; each JSDoc names the C function and file it came from. Code the port added follows the house `object_verb` style (`cli_run`, `dumpPath_get`, `trekArgs_parse`), and `lint:trek` refuses a name that is neither. Every function carries a JSDoc block, with explicit types and named interfaces throughout. `TrekTerminal`, the interface a host implements to run the game, renames its members to `text_write`, `question_ask` and `seconds_sleep`; brasa's `trek` builtin implements the new names. The game plays exactly as before: the eighteen games recorded from the C still replay byte for byte.
