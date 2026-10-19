# bsd-trek

## 0.4.0

### Minor Changes

- f42918a: trek takes the screen in ARGUS: a bridge drawn from the state the engine shows, played through its controls.

  `trek` typed at the transcript console opens the bridge over ARGUS and runs the session's `trek` as the operator's own command. The bridge reads the state the engine shows before each `Command:` prompt (a header of condition, ship, mission and position, the short- and long-range scans, the galaxy chart as the ship knows it, engineering) and answers the engine's questions one at a time from controls lit by the question: command pills, a course wheel, sliders for distance, warp factor, rest and phaser units, pills for choices, and a strip for the questions the engine asks on its own. The ship's log is the game's own words, read only. LEAVE BRIDGE (and Esc, which asks first) abandons the open question; the engine reads end of input and ends the game as the C does, and ARGUS comes back. bsd-trek gains `bsd-trek/host` (the state's types and the C's tables and codes, with no engine behind them, for a host that draws the game), its styling wrapper passes `state_show` through, and end of input is asked for once. The session's `trek` reads an abandoned question as end of input.

- 21649d1: A running command can show its surface a typed event, and trek shows its state at every Command: prompt.

  `OutputSink` gains `event_write(kind, data)`, the wire gains the `event` message (daemon to the command's origin surface, live only), and the ARGUS client hands events to its host. bsd-trek's `TrekTerminal` gains `state_show`, called with a deep copy of the whole game state before each command is asked for; the session's `trek` sends it as `games.trek.state`. The recorded C games replay unchanged; a terminal that only prints leaves `state_show` out. This is what a bridge that draws the game reads, instead of the printed scans.

## 0.3.0

### Minor Changes

- 5c49254: trek shows its credits with `credits` in the game and `trek --credits`, and Ctrl-C ends a game cleanly.

  `credits` at the `Command:` prompt and `trek --credits` (in a terminal and in mise's session) name the game's authors as the C's own credits do, the TypeScript port by Rudolph Pienaar, and mise and ChRIS. The command is the port's, last in the command table, and takes no time. Ctrl-C in the `bsd-trek` command now ends the game at once with status 130, as the original's interrupt did, instead of a readline stack trace.

## 0.2.0

### Minor Changes

- 313d1f7: bsd-trek keeps the C's names for ported code and names everything the port added object_verb, all of it documented.

  Functions ported from NetBSD's C keep the C's names (`dowarp`, `getcodpar`), so the port reads side by side with its source; each JSDoc names the C function and file it came from. Code the port added follows the house `object_verb` style (`cli_run`, `dumpPath_get`, `trekArgs_parse`), and `lint:trek` refuses a name that is neither. Every function carries a JSDoc block, with explicit types and named interfaces throughout. `TrekTerminal`, the interface a host implements to run the game, renames its members to `text_write`, `question_ask` and `seconds_sleep`; brasa's `trek` builtin implements the new names. The game plays exactly as before: the eighteen games recorded from the C still replay byte for byte.
