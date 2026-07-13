---
"@fnndsc/brasa": minor
---

Add `date` and `cal` builtins, in the spirit of their UNIX namesakes and fully self-contained (pure computation — no host binary, no subprocess). `date` prints the current date/time with the familiar default format, `-u` for UTC, and `+FORMAT` strftime-style format strings (it reports the time only, never sets the clock). `cal` prints a month (`cal`), a whole year (`cal <year>`), or a specific month (`cal <month> <year>`), with today highlighted. Both return their output in an envelope through the sink, so they work identically local, over a CALYPSO daemon, and in the standalone binary.
