# @fnndsc/argus

argus is not published to npm, so changesets writes no changelog for it. This file is that record, kept by hand.

## 2026-09-04

fix(argus): the operator divides the stage, not a constant

The console could not be dragged past roughly half the frame. The drag had no cap of its own; the wall was a `min-height: 20rem` workspace floor on `main`. A floor there is a ceiling here, because the drawer can only grow into space the workspace will give up, and the floor was lifted only for the console's own zoom.

The floor is gone. The drag is now bounded only by what the screen imposes: a minimum so the strip stays grabbable, and a ceiling that keeps the console's own header on screen so the controls that shrink it again remain reachable.

fix(argus): the PACS listing uses the space it has, and the header slide stops guessing

**The progress bars sat where there was no room.** A series row put the description on `1fr` and the bar in a fixed cell wedged between the file count and the capsule, so the description hoarded a thousand-odd pixels of empty width while the bar had a few dozen. The description now takes what it needs up to a limit and the bar takes the rest, stretching from the description across to the modality.

**Enter runs the query** from any term field, not only the command line. Filling a field and pressing return is what a form means.

**Waiting is visible.** A query in flight shows a pacing bar and says so, rather than one line of static text that reads like a finished empty result. A pull in flight now draws a bar that fills by current over total, and paces when there is no total instead of pretending to a fraction it does not know; previously it only changed a word.

**A study wears the same frame as any other listing**, in the roster's own idiom: a bar of caps naming SERIES, STATE, MODALITY and FILES, sharing the row's track definition so each cap sits over its column.

**The header's slide distance is no longer a stale measurement.** It was captured once at the moment of the gesture, but the header's height is not fixed — version rows arrive from the daemon after attach — so the slide could fall short by anywhere from one to thirteen pixels depending on timing. It now tracks the header's resting extent and freezes during the slide, since zooming hides the lid and makes the header shorter than the distance it has to travel.

fix(argus): runs-02 gets the same frame treatment, and 02-CALYPSO matches ARGUS WEB

The runs roster shared one scrolling box with its caps, so its scrollbar ran the full height of the pane and up behind the frame — the same defect the files browser had. The caps now sit above a scrolling field, and the roster shows as a flex column rather than a block.

The version face stops being its own design. It had picked up a private set of overrides — smaller label pills, shrunken fonts, tightened line heights, a bespoke grid — none of which the ARGUS WEB face uses. They are gone. It now uses the same three-column idiom, the same type and the same pill width, verified against a live daemon: both faces report three columns, a 15.4px label, a 19.8px value and a 209px pill. The cycler gives back the width to make room, from two fifths of the band to under a third.

One structural correction stays: the columns belong on the readout, not on the face. The rows live inside an `about-rows` wrapper, so columns set a level above it fragment the wrapper rather than its rows, which left every row in the first column and the rest of the band empty.

Values still elide rather than wrap, so a long git hash or build date cannot disturb the layout, with the whole text on hover.

test(argus): the smoke suite waits for motion to stop instead of guessing how long it takes

Several scenarios slept a fixed number of milliseconds after a gesture that animates, then measured. That samples a CSS transition at an arbitrary moment: sometimes mid-glide, sometimes before the click had even registered. The header-slide check drifted between one and thirteen pixels of residue and occasionally read the header's full resting position, and the split-zoom, restore-strip and mode-frame checks flickered alongside it.

Scenarios now wait for the value under test to stop changing. The checks are stricter as a result, not looser: the header-slide tolerance goes back to a single pixel, where it had been widened to two to accommodate the noise.

No production behaviour changes here. The one thing worth stating plainly is what this was not: the slide distance was correct throughout, and two attempts to "fix" it in the page were reverted once the suite could measure it honestly.
