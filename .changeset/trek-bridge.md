---
"@fnndsc/argus": minor
"bsd-trek": minor
"@fnndsc/brasa": patch
---

trek takes the screen in ARGUS: a bridge drawn from the state the engine shows, played through its controls.

`trek` typed at the transcript console opens the bridge over ARGUS and runs the session's `trek` as the operator's own command. The bridge reads the state the engine shows before each `Command:` prompt (a header of condition, ship, mission and position, the short- and long-range scans, the galaxy chart as the ship knows it, engineering) and answers the engine's questions one at a time from controls lit by the question: command pills, a course wheel, sliders for distance, warp factor, rest and phaser units, pills for choices, and a strip for the questions the engine asks on its own. The ship's log is the game's own words, read only. LEAVE BRIDGE (and Esc, which asks first) abandons the open question; the engine reads end of input and ends the game as the C does, and ARGUS comes back. bsd-trek gains `bsd-trek/host` (the state's types and the C's tables and codes, with no engine behind them, for a host that draws the game), its styling wrapper passes `state_show` through, and end of input is asked for once. The session's `trek` reads an abandoned question as end of input.
