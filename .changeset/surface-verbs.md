---
"@fnndsc/calypso": minor
"@fnndsc/menu": minor
"@fnndsc/chell": minor
"@fnndsc/argus": minor
---

ARGUS's own words now work from any chell on the session, including `desktop show`, `view runs` and `dag census on`. A browser declares the subjects its language claims (whole subjects such as `dag`, `desktop` and `pane`, and only listed verbs of shared ones such as `file open` and `help keys`). The daemon then routes a single command in a claimed subject to that browser instead of the engine, and the chell prints the browser's answer. The browser that owns a chell's terminal answers first, then the most recently active one. With no browser attached, a subject claimed whole is refused by name, and a shared subject stays the session's. Tab completion offers the claimed words. A browser can also send a note to its own consoles, printed above the line being typed. A terminal's chell now tells the daemon which terminal it draws. This is the groundwork for ARGUS's console becoming a terminal (#1125).
