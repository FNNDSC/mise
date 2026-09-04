---
"argus": patch
---

fix(argus): the PACS listing uses the space it has, and the header slide stops guessing

**The progress bars sat where there was no room.** A series row put the description on `1fr` and the bar in a fixed cell wedged between the file count and the capsule, so the description hoarded a thousand-odd pixels of empty width while the bar had a few dozen. The description now takes what it needs up to a limit and the bar takes the rest, stretching from the description across to the modality.

**Enter runs the query** from any term field, not only the command line. Filling a field and pressing return is what a form means.

**Waiting is visible.** A query in flight shows a pacing bar and says so, rather than one line of static text that reads like a finished empty result. A pull in flight now draws a bar that fills by current over total, and paces when there is no total instead of pretending to a fraction it does not know; previously it only changed a word.

**A study wears the same frame as any other listing**, in the roster's own idiom: a bar of caps naming SERIES, STATE, MODALITY and FILES, sharing the row's track definition so each cap sits over its column.

**The header's slide distance is no longer a stale measurement.** It was captured once at the moment of the gesture, but the header's height is not fixed — version rows arrive from the daemon after attach — so the slide could fall short by anywhere from one to thirteen pixels depending on timing. It now tracks the header's resting extent and freezes during the slide, since zooming hides the lid and makes the header shorter than the distance it has to travel.
